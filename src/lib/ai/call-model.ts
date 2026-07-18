// THE single entry point for all AI calls (CLAUDE.md #2).
// Every call — success or failure — writes one AiCallLog row (docs/tech/04-audit.md).
import { prisma } from "@/lib/db";
import { parseModelKeyStrict } from "@/lib/ai/model-key";
import { getProviderKey } from "@/lib/ai/provider-key";
import { priceText } from "@/lib/ai/capabilities";
import { openrouterAdapter } from "@/lib/ai/adapters/openrouter";
import { fakeAdapter } from "@/lib/ai/adapters/fake";
import {
  AiError,
  type CallContext,
  type TextAdapter,
  type TextRequest,
  type TextResult,
} from "@/lib/ai/types";

const textAdapters: Record<string, TextAdapter> = {
  openrouter: openrouterAdapter,
  fake: fakeAdapter,
};

export async function callModel(ctx: CallContext, req: TextRequest): Promise<TextResult> {
  const parsed = parseModelKeyStrict(req.modelKey);
  if (!parsed) throw new AiError("INVALID_MODEL_KEY", `modelKey must be provider::modelId, got: ${req.modelKey}`);

  const adapter = textAdapters[parsed.provider];
  if (!adapter) throw new AiError("PROVIDER_UNKNOWN", `no text adapter for provider: ${parsed.provider}`);

  const apiKey = await getProviderKey(ctx.userId, parsed.provider);
  const startedAt = Date.now();

  try {
    const result = await adapter.complete(req, apiKey, { promptId: ctx.promptId });
    // Blended input+output token cost from the catalog; missing entry → null.
    const price = priceText(req.modelKey, result.usage.inputTokens, result.usage.outputTokens);
    // AWAIT the log write: ENFORCE settlement sums ai_call_logs right after the
    // handler returns, so the row must be durable before we do (else under-charge).
    await logAiCall(ctx, req, {
      latencyMs: Date.now() - startedAt,
      status: "ok",
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      estCostUsd: price?.estCostUsd ?? null,
      providerRequestId: result.providerRequestId,
    });
    return result;
  } catch (err) {
    await logAiCall(ctx, req, {
      latencyMs: Date.now() - startedAt,
      status: "error",
      errorCode: err instanceof AiError ? err.code : "UNKNOWN",
    });
    throw err;
  }
}

interface LogFields {
  latencyMs: number;
  status: "ok" | "error";
  inputTokens?: number;
  outputTokens?: number;
  estCostUsd?: number | null;
  errorCode?: string;
  providerRequestId?: string;
}

// Awaited by callers so the row is durable before ENFORCE settlement reads it.
// The insert error is swallowed (a dropped log must not fail generation), but the
// await still guarantees ordering vs settle. Returns a never-rejecting promise.
function logAiCall(ctx: CallContext, req: TextRequest, f: LogFields): Promise<void> {
  return prisma.aiCallLog
    .create({
      data: {
        userId: ctx.userId,
        modelKey: req.modelKey,
        apiType: "text",
        promptId: ctx.promptId,
        promptVersion: ctx.promptVersion,
        taskId: ctx.taskId,
        projectId: ctx.projectId,
        episodeId: ctx.episodeId,
        inputTokens: f.inputTokens,
        outputTokens: f.outputTokens,
        estCostUsd: f.estCostUsd,
        latencyMs: f.latencyMs,
        status: f.status,
        errorCode: f.errorCode,
        providerRequestId: f.providerRequestId,
      },
    })
    .then(() => {})
    .catch((err) => {
      console.error("[ai-call-log] write failed", { modelKey: req.modelKey, err: String(err) });
    });
}
