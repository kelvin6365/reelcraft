// OpenRouter text adapter. Only call-model.ts may import this (guard: no-ai-bypass).
import { AiError, type TextAdapter, type TextRequest, type TextResult } from "@/lib/ai/types";
import { parseModelKeyStrict } from "@/lib/ai/model-key";

const BASE_URL = "https://openrouter.ai/api/v1";

// Malformed usage values map to undefined — cost capture must never fail a
// successful generation.
function nonNegNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function providerCost(usage?: { cost?: number; cost_details?: { upstream_inference_cost?: number | null } }): number | undefined {
  const cost = nonNegNumber(usage?.cost);
  const upstream = nonNegNumber(usage?.cost_details?.upstream_inference_cost);
  if (cost === undefined && upstream === undefined) return undefined;
  return (cost ?? 0) + (upstream ?? 0);
}

export const openrouterAdapter: TextAdapter = {
  provider: "openrouter",

  async complete(req: TextRequest, apiKey: string): Promise<TextResult> {
    const parsed = parseModelKeyStrict(req.modelKey);
    if (!parsed) throw new AiError("INVALID_MODEL_KEY", `bad modelKey: ${req.modelKey}`);

    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: parsed.modelId,
        messages: req.messages,
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        // Constrain to a JSON object so the model can't wrap it in prose/markdown
        // or emit trailing garbage — the top cause of "output is not valid JSON".
        ...(req.jsonMode ? { response_format: { type: "json_object" } } : {}),
        usage: { include: true }, // ask for real billed cost + token detail
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const retryable = res.status === 429 || res.status >= 500;
      throw new AiError(`HTTP_${res.status}`, `openrouter: ${body.slice(0, 500)}`, retryable);
    }

    const json = (await res.json()) as {
      id?: string;
      choices?: { message?: { content?: string } }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        cost?: number;
        // BYOK requests: `cost` is only OpenRouter's fee, the real provider
        // charge arrives here — the true bill is the sum of both.
        cost_details?: { upstream_inference_cost?: number | null };
        prompt_tokens_details?: { cached_tokens?: number };
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };

    const text = json.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new AiError("EMPTY_RESPONSE", "openrouter returned no content", true);
    }

    return {
      text,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        cachedInputTokens: nonNegNumber(json.usage?.prompt_tokens_details?.cached_tokens),
        reasoningTokens: nonNegNumber(json.usage?.completion_tokens_details?.reasoning_tokens),
        providerCostUsd: providerCost(json.usage),
      },
      providerRequestId: json.id,
    };
  },
};
