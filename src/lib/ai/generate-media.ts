// THE single entry point for media generation (image/video/tts) — CLAUDE.md #2.
// Resolves provider from the model key, generates, stores the result as a
// MediaObject, and writes one AiCallLog row per call (success or failure).
// fal / atlascloud adapters land when API keys are provisioned; until then the
// `fake` provider (ffmpeg-generated real assets) keeps the pipeline runnable.
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { parseModelKeyStrict } from "@/lib/ai/model-key";
import { AiError, type CallContext } from "@/lib/ai/types";
import { fakeImage, fakeTts, fakeVideo } from "@/lib/ai/adapters/fake-media";
import { createMediaFromBuffer } from "@/lib/media/service";
import type { MediaObject } from "@prisma/client";

export interface ImageGenRequest {
  modelKey: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: string; // '9:16' | '16:9'
  keyPrefix: string; // storage prefix, e.g. `projects/{id}/characters`
}

export interface VideoGenRequest {
  modelKey: string;
  prompt: string;
  sourceImageMediaId?: string;
  durationSec: number;
  aspectRatio: string;
  keyPrefix: string;
}

export interface TtsGenRequest {
  modelKey: string;
  text: string;
  voiceId?: string;
  emotionStrength?: number;
  keyPrefix: string;
}

interface GenOutcome {
  media: MediaObject;
  quantity: number;
  unit: "image" | "second" | "character";
}

async function generate(
  ctx: CallContext,
  apiType: "image" | "video" | "tts",
  modelKey: string,
  run: (provider: string) => Promise<GenOutcome>,
): Promise<MediaObject> {
  const parsed = parseModelKeyStrict(modelKey);
  if (!parsed) throw new AiError("INVALID_MODEL_KEY", `modelKey must be provider::modelId, got: ${modelKey}`);
  if (parsed.provider === "fake" && env.NODE_ENV === "production") {
    throw new AiError("PROVIDER_NOT_ALLOWED", "fake provider is dev/test only");
  }

  const startedAt = Date.now();
  try {
    const outcome = await run(parsed.provider);
    logMediaCall(ctx, modelKey, apiType, {
      latencyMs: Date.now() - startedAt,
      status: "ok",
      quantity: outcome.quantity,
      unit: outcome.unit,
    });
    return outcome.media;
  } catch (err) {
    logMediaCall(ctx, modelKey, apiType, {
      latencyMs: Date.now() - startedAt,
      status: "error",
      errorCode: err instanceof AiError ? err.code : "UNKNOWN",
    });
    throw err;
  }
}

export async function generateImage(ctx: CallContext, req: ImageGenRequest): Promise<MediaObject> {
  return generate(ctx, "image", req.modelKey, async (provider) => {
    if (provider === "fake") {
      const { buffer, mimeType } = await fakeImage(req.prompt, req.aspectRatio);
      const media = await createMediaFromBuffer({ userId: ctx.userId, buffer, mimeType, keyPrefix: req.keyPrefix });
      return { media, quantity: 1, unit: "image" };
    }
    throw new AiError("PROVIDER_NOT_IMPLEMENTED", `image provider not wired yet: ${provider}`);
  });
}

export async function generateVideo(ctx: CallContext, req: VideoGenRequest): Promise<MediaObject> {
  return generate(ctx, "video", req.modelKey, async (provider) => {
    if (provider === "fake") {
      const { buffer, mimeType } = await fakeVideo(req.prompt, req.durationSec, req.aspectRatio);
      const media = await createMediaFromBuffer({ userId: ctx.userId, buffer, mimeType, keyPrefix: req.keyPrefix });
      return { media, quantity: req.durationSec, unit: "second" };
    }
    throw new AiError("PROVIDER_NOT_IMPLEMENTED", `video provider not wired yet: ${provider}`);
  });
}

export async function generateTts(ctx: CallContext, req: TtsGenRequest): Promise<MediaObject> {
  return generate(ctx, "tts", req.modelKey, async (provider) => {
    if (provider === "fake") {
      const { buffer, mimeType, seconds } = await fakeTts(req.text);
      const media = await createMediaFromBuffer({ userId: ctx.userId, buffer, mimeType, keyPrefix: req.keyPrefix });
      return { media, quantity: seconds, unit: "second" };
    }
    throw new AiError("PROVIDER_NOT_IMPLEMENTED", `tts provider not wired yet: ${provider}`);
  });
}

interface MediaLogFields {
  latencyMs: number;
  status: "ok" | "error";
  quantity?: number;
  unit?: string;
  errorCode?: string;
}

function logMediaCall(ctx: CallContext, modelKey: string, apiType: string, f: MediaLogFields): void {
  void prisma.aiCallLog
    .create({
      data: {
        userId: ctx.userId,
        modelKey,
        apiType,
        taskId: ctx.taskId,
        projectId: ctx.projectId,
        episodeId: ctx.episodeId,
        quantity: f.quantity,
        unit: f.unit,
        latencyMs: f.latencyMs,
        status: f.status,
        errorCode: f.errorCode,
      },
    })
    .catch((err) => console.error("[ai-call-log] media write failed", { modelKey, err: String(err) }));
}
