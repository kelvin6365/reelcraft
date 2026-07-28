import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { parseModelKeyStrict } from "@/lib/ai/model-key";
import { getProviderKey } from "@/lib/ai/provider-key";
import { getCapabilities, getCapabilityEntry, priceMedia } from "@/lib/ai/capabilities";
import { AiError, type CallContext } from "@/lib/ai/types";
import { fakeImage, fakeTts, fakeVideo } from "@/lib/ai/adapters/fake-media";
import { falImage, falTts, falVideo } from "@/lib/ai/adapters/fal";
import { atlasImage, atlasTts, atlasVideo } from "@/lib/ai/adapters/atlascloud";
import { loadTemplates, runTemplate, type TemplateVars } from "@/lib/ai/template/runtime";
import { normalizeReferenceImages } from "@/lib/ai/outbound-image";
import { createMediaFromBuffer, createMediaFromUrl, getMediaUrl } from "@/lib/media/service";
import type { MediaObject } from "@prisma/client";

async function getOutboundImageUrl(mediaId: string): Promise<string> {
  const url = await getMediaUrl(mediaId);
  if (url?.startsWith("https://")) return url;
  const media = await prisma.mediaObject.findUnique({ where: { id: mediaId } });
  if (!media) throw new AiError("SOURCE_IMAGE_MISSING", `source image not found: ${mediaId}`);
  const { getStorage } = await import("@/lib/storage");
  const buffer = await getStorage().getObjectBuffer(media.storageKey);
  return `data:${media.mimeType || "image/png"};base64,${buffer.toString("base64")}`;
}

async function runTemplateProvider(
  ctx: CallContext,
  apiType: "image" | "video" | "tts",
  templateId: string,
  keyPrefix: string,
  vars: TemplateVars,
): Promise<MediaObject> {
  const templates = await loadTemplates();
  const t = templates.get(templateId);
  if (!t) throw new AiError("TEMPLATE_NOT_FOUND", `no template: ${templateId}`);
  if (t.apiType !== apiType) throw new AiError("TEMPLATE_TYPE_MISMATCH", `${templateId} is ${t.apiType}, not ${apiType}`);
  const apiKey = await getProviderKey(ctx.userId, t.apiKeyRef);
  const { resultUrl } = await runTemplate(t, { ...vars, model: templateId }, apiKey);
  return createMediaFromUrl({ userId: ctx.userId, url: resultUrl, keyPrefix });
}

export interface ImageGenRequest {
  modelKey: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: string;
  // 目標解像度層級——模型能力表（capabilities.resolutions）冇聲明支援嘅話會被靜默剝走，
  // 交由 provider 預設輸出，唔會令任務失敗。
  resolution?: ImageResolution;
  keyPrefix: string;
  referenceMediaIds?: string[];
}

export type ImageResolution = "1K" | "2K" | "4K";

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
  providerRequestId?: string;
}

interface ParsedProvider {
  provider: string;
  modelId: string;
}

async function generate(
  ctx: CallContext,
  apiType: "image" | "video" | "tts",
  modelKey: string,
  run: (parsed: ParsedProvider) => Promise<GenOutcome>,
): Promise<MediaObject> {
  const parsed = parseModelKeyStrict(modelKey);
  if (!parsed) throw new AiError("INVALID_MODEL_KEY", `modelKey must be provider::modelId, got: ${modelKey}`);
  if (parsed.provider === "fake" && env.NODE_ENV === "production") {
    throw new AiError("PROVIDER_NOT_ALLOWED", "fake provider is dev/test only");
  }

  const { assertWithinBudget } = await import("@/lib/billing/budget");
  await assertWithinBudget(ctx.projectId);

  const startedAt = Date.now();
  try {
    const outcome = await run(parsed);
    const price = priceMedia(modelKey, outcome.quantity);
    await logMediaCall(ctx, modelKey, apiType, {
      latencyMs: Date.now() - startedAt,
      status: "ok",
      quantity: outcome.quantity,
      unit: outcome.unit,
      unitPriceSnapshot: price?.unitPriceSnapshot ?? null,
      estCostUsd: price?.estCostUsd ?? null,
      providerRequestId: outcome.providerRequestId,
    });
    return outcome.media;
  } catch (err) {
    await logMediaCall(ctx, modelKey, apiType, {
      latencyMs: Date.now() - startedAt,
      status: "error",
      errorCode: err instanceof AiError ? err.code : "UNKNOWN",
    });
    throw err;
  }
}

export function effectiveImageModelKey(modelKey: string, hasRefs: boolean): string {
  if (!hasRefs || !modelKey.startsWith("atlascloud::") || !modelKey.endsWith("/text-to-image")) return modelKey;
  const editKey = modelKey.replace(/\/text-to-image$/, "/edit");
  return getCapabilityEntry(editKey) ? editKey : modelKey;
}

export async function generateImage(ctx: CallContext, req: ImageGenRequest): Promise<MediaObject> {
  const referenceImages = req.referenceMediaIds?.length
    ? await normalizeReferenceImages(req.referenceMediaIds)
    : undefined;

  const modelKey = effectiveImageModelKey(req.modelKey, !!referenceImages?.length);

  if (referenceImages?.length && !getCapabilities(modelKey)?.supportsReferenceImages) {
    throw new AiError(
      "MODEL_NO_REFERENCE_SUPPORT",
      `${modelKey} 唔支援參考圖（img2img）——鎖定資產嘅角色一致性會失效。請喺專案設定揀一個支援參考圖嘅圖像模型。`,
      false,
    );
  }

  const resolution =
    req.resolution && getCapabilities(modelKey)?.resolutions?.includes(req.resolution) ? req.resolution : undefined;

  return generate(ctx, "image", modelKey, async ({ provider, modelId }) => {
    if (provider === "fake") {
      const { buffer, mimeType } = await fakeImage(req.prompt, req.aspectRatio);
      const media = await createMediaFromBuffer({ userId: ctx.userId, buffer, mimeType, keyPrefix: req.keyPrefix });
      return { media, quantity: 1, unit: "image" };
    }
    if (provider === "fal" || provider === "atlascloud") {
      const apiKey = await getProviderKey(ctx.userId, provider);
      if (provider === "fal") {
        const { url, providerRequestId } = await falImage({
          modelId,
          prompt: req.prompt,
          negativePrompt: req.negativePrompt,
          aspectRatio: req.aspectRatio,
          resolution,
          apiKey,
          referenceImages,
        });
        const media = await createMediaFromUrl({ userId: ctx.userId, url, keyPrefix: req.keyPrefix });
        return { media, quantity: 1, unit: "image", providerRequestId };
      }
      const { url, providerRequestId } = await atlasImage({
        modelId,
        prompt: req.prompt,
        negativePrompt: req.negativePrompt,
        aspectRatio: req.aspectRatio,
        resolution,
        apiKey,
        referenceImages,
      });
      const media = await createMediaFromUrl({ userId: ctx.userId, url, keyPrefix: req.keyPrefix });
      return { media, quantity: 1, unit: "image", providerRequestId };
    }
    if (provider === "template") {
      const media = await runTemplateProvider(ctx, "image", modelId, req.keyPrefix, {
        prompt: req.prompt,
        negative_prompt: req.negativePrompt ?? "",
        aspect_ratio: req.aspectRatio,
      });
      return { media, quantity: 1, unit: "image" };
    }
    throw new AiError("PROVIDER_NOT_IMPLEMENTED", `image provider not wired yet: ${provider}`);
  });
}

function clampDuration(modelKey: string, requested: number): number {
  const caps = getCapabilities(modelKey);
  const allowed = caps?.durationsSec;
  if (!allowed || allowed.length === 0) return requested;
  return [...allowed].sort((a, b) => Math.abs(a - requested) - Math.abs(b - requested) || b - a)[0];
}

export async function generateVideo(ctx: CallContext, req: VideoGenRequest): Promise<MediaObject> {
  req = { ...req, durationSec: clampDuration(req.modelKey, req.durationSec) };
  return generate(ctx, "video", req.modelKey, async ({ provider, modelId }) => {
    if (provider === "fake") {
      const { buffer, mimeType } = await fakeVideo(req.prompt, req.durationSec, req.aspectRatio);
      const media = await createMediaFromBuffer({ userId: ctx.userId, buffer, mimeType, keyPrefix: req.keyPrefix });
      return { media, quantity: req.durationSec, unit: "second" };
    }
    if (provider === "fal" || provider === "atlascloud") {
      const apiKey = await getProviderKey(ctx.userId, provider);
      const imageUrl = req.sourceImageMediaId ? await getOutboundImageUrl(req.sourceImageMediaId) : null;
      const gen = provider === "fal" ? falVideo : atlasVideo;
      const { url, providerRequestId } = await gen({
        modelId,
        prompt: req.prompt,
        imageUrl: imageUrl ?? undefined,
        durationSec: req.durationSec,
        aspectRatio: req.aspectRatio,
        apiKey,
      });
      const media = await createMediaFromUrl({ userId: ctx.userId, url, keyPrefix: req.keyPrefix });
      return { media, quantity: req.durationSec, unit: "second", providerRequestId };
    }
    if (provider === "template") {
      const imageUrl = req.sourceImageMediaId ? await getMediaUrl(req.sourceImageMediaId) : null;
      const media = await runTemplateProvider(ctx, "video", modelId, req.keyPrefix, {
        prompt: req.prompt,
        image_url: imageUrl ?? "",
        duration: String(req.durationSec),
        aspect_ratio: req.aspectRatio,
      });
      return { media, quantity: req.durationSec, unit: "second" };
    }
    throw new AiError("PROVIDER_NOT_IMPLEMENTED", `video provider not wired yet: ${provider}`);
  });
}

export async function generateTts(ctx: CallContext, req: TtsGenRequest): Promise<MediaObject> {
  return generate(ctx, "tts", req.modelKey, async ({ provider, modelId }) => {
    if (provider === "fake") {
      const { buffer, mimeType, seconds } = await fakeTts(req.text);
      const media = await createMediaFromBuffer({ userId: ctx.userId, buffer, mimeType, keyPrefix: req.keyPrefix });
      return { media, quantity: seconds, unit: "second" };
    }
    if (provider === "fal" || provider === "atlascloud") {
      const apiKey = await getProviderKey(ctx.userId, provider);
      const referenceAudioUrl = req.voiceId ? (await getMediaUrl(req.voiceId)) ?? undefined : undefined;
      const gen = provider === "fal" ? falTts : atlasTts;
      const { url, providerRequestId } = await gen({ modelId, text: req.text, referenceAudioUrl, apiKey });
      const media = await createMediaFromUrl({ userId: ctx.userId, url, keyPrefix: req.keyPrefix });
      return { media, quantity: req.text.length, unit: "character", providerRequestId };
    }
    if (provider === "template") {
      const media = await runTemplateProvider(ctx, "tts", modelId, req.keyPrefix, {
        text: req.text,
        voice_id: req.voiceId ?? "",
      });
      return { media, quantity: req.text.length, unit: "character" };
    }
    throw new AiError("PROVIDER_NOT_IMPLEMENTED", `tts provider not wired yet: ${provider}`);
  });
}

interface MediaLogFields {
  latencyMs: number;
  status: "ok" | "error";
  quantity?: number;
  unit?: string;
  unitPriceSnapshot?: number | null;
  estCostUsd?: number | null;
  providerRequestId?: string;
  errorCode?: string;
}

function logMediaCall(ctx: CallContext, modelKey: string, apiType: string, f: MediaLogFields): Promise<void> {
  return prisma.aiCallLog
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
        unitPriceSnapshot: f.unitPriceSnapshot,
        estCostUsd: f.estCostUsd,
        latencyMs: f.latencyMs,
        status: f.status,
        errorCode: f.errorCode,
        providerRequestId: f.providerRequestId,
      },
    })
    .then(() => {})
    .catch((err) => console.error("[ai-call-log] media write failed", { modelKey, err: String(err) }));
}
