// THE single entry point for all AI calls (CLAUDE.md #2).
// Every call — success or failure — writes one AiCallLog row (docs/tech/04-audit.md).
import { prisma } from "@/lib/db";
import { parseModelKeyStrict } from "@/lib/ai/model-key";
import { getProviderKey } from "@/lib/ai/provider-key";
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

  const apiKey = getProviderKey(ctx.userId, parsed.provider);
  const startedAt = Date.now();

  try {
    const result = await adapter.complete(req, apiKey);
    logAiCall(ctx, req, {
      latencyMs: Date.now() - startedAt,
      status: "ok",
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      providerRequestId: result.providerRequestId,
    });
    return result;
  } catch (err) {
    logAiCall(ctx, req, {
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
  errorCode?: string;
  providerRequestId?: string;
}

// Fire-and-forget: logging must never break or slow the main flow,
// but a dropped log is still surfaced on console.
function logAiCall(ctx: CallContext, req: TextRequest, f: LogFields): void {
  void prisma.aiCallLog
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
        latencyMs: f.latencyMs,
        status: f.status,
        errorCode: f.errorCode,
        providerRequestId: f.providerRequestId,
      },
    })
    .catch((err) => {
      console.error("[ai-call-log] write failed", { modelKey: req.modelKey, err: String(err) });
    });
}
