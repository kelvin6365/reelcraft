// OpenRouter text adapter. Only call-model.ts may import this (guard: no-ai-bypass).
import { AiError, type TextAdapter, type TextRequest, type TextResult } from "@/lib/ai/types";
import { parseModelKeyStrict } from "@/lib/ai/model-key";

const BASE_URL = "https://openrouter.ai/api/v1";

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
      usage?: { prompt_tokens?: number; completion_tokens?: number };
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
      },
      providerRequestId: json.id,
    };
  },
};
