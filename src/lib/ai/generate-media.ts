import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { parseModelKeyStrict } from "@/lib/ai/model-key";
import { getProviderKey } from "@/lib/ai/provider-key";
import { getCapabilities, getCapabilityEntry, priceMedia } from "@/lib/ai/capabilities";
import { AiError, type CallContext } from "@/lib/ai/types";
import { fakeImage, fakeTts, fakeVideo } from "@/lib/ai/adapters/fake-media";
import { falImageSubmit, falPoll, falTtsSubmit, falVideoSubmit } from "@/lib/ai/adapters/fal";
import { atlasImageSubmit, atlasPoll, atlasTtsSubmit, atlasVideoSubmit } from "@/lib/ai/adapters/atlascloud";
import { markConsumed, runJournaled } from "@/lib/ai/request-journal";
import { loadTemplates, runTemplate, type TemplateVars } from "@/lib/ai/template/runtime";
import { dedupeReferenceRefs, normalizeReferenceImages, type ReferenceImageRef } from "@/lib/ai/outbound-image";
import { createMediaFromBuffer, createMediaFromUrl, getMediaUrl } from "@/lib/media/service";
import type { VoiceBinding } from "@/lib/voice/binding";
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
  // 參考圖：可以係純 mediaId，亦可以係 { mediaId, identityAnchor: true } —— 後者
  // 標明「呢張係身份錨定圖（角色近臉特寫）」，會走高解析度／低壓縮路徑而且唔會
  // 按出圖比例 center-crop（見 outbound-image.ts）。
  referenceMediaIds?: ReferenceImageRef[];
}

export type ImageResolution = "1K" | "2K" | "4K";

export interface VideoGenRequest {
  modelKey: string;
  prompt: string;
  sourceImageMediaId?: string;
  // 尾幀錨定（首尾幀）：條片會由 sourceImageMediaId 過渡到呢張圖。用落一鏡嘅分鏡圖做
  // 尾幀，兩條片喺接口嗰格完全一樣，剪埋一齊零跳。模型能力表冇聲明 supportsEndFrame
  // 就會被靜默剝走（照生片，唔會令任務失敗）—— 同 resolution 一樣嘅降級風格。
  endImageMediaId?: string;
  durationSec: number;
  aspectRatio: string;
  keyPrefix: string;
}

export interface TtsGenRequest {
  modelKey: string;
  text: string;
  // 邊把聲 —— 由 resolveVoiceBinding() 解出嚟，null = 未派音（provider 預設聲）。
  // 呼叫方要負責喺派音之前攔住，唔好靜靜生成一堆同一把聲嘅音檔。
  voice?: VoiceBinding | null;
  // voice_analyze 標註嘅中文情緒詞；adapter 內部收窄成 provider 枚舉
  emotion?: string;
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
  // 次序好重要：先由參考圖數量決定最終 model key（t2i → /edit swap），再 normalize。
  // Normalize 要知道目標比例（將來仲會要知 per-model capability），所以唔可以再喺
  // model key 未定案之前跑。用 dedupeReferenceRefs 而唔係 raw array length，
  // 令「hasRefs」同 normalize 實際會處理嘅張數對齊（空字串／重複會被剔走）。
  const refs = dedupeReferenceRefs(req.referenceMediaIds ?? []);
  const modelKey = effectiveImageModelKey(req.modelKey, refs.length > 0);

  if (refs.length > 0 && !getCapabilities(modelKey)?.supportsReferenceImages) {
    throw new AiError(
      "MODEL_NO_REFERENCE_SUPPORT",
      `${modelKey} 唔支援參考圖（img2img）——鎖定資產嘅角色一致性會失效。請喺專案設定揀一個支援參考圖嘅圖像模型。`,
      false,
    );
  }

  const resolution =
    req.resolution && getCapabilities(modelKey)?.resolutions?.includes(req.resolution) ? req.resolution : undefined;

  // 裁到出圖比例：Gemini「採用最後一張輸入圖嘅比例」，1344×768 嘅場景圖入 9:16
  // 出圖會令模型砌橫構圖再 letterbox → 燒死黑邊。
  const referenceImages = refs.length ? await normalizeReferenceImages(refs, { aspectRatio: req.aspectRatio }) : undefined;

  return generate(ctx, "image", modelKey, async ({ provider, modelId }) => {
    if (provider === "fake") {
      const { buffer, mimeType } = await fakeImage(req.prompt, req.aspectRatio);
      const media = await createMediaFromBuffer({ userId: ctx.userId, buffer, mimeType, keyPrefix: req.keyPrefix });
      return { media, quantity: 1, unit: "image" };
    }
    if (provider === "fal" || provider === "atlascloud") {
      const apiKey = await getProviderKey(ctx.userId, provider);
      const args = {
        modelId,
        prompt: req.prompt,
        negativePrompt: req.negativePrompt,
        aspectRatio: req.aspectRatio,
        resolution,
        apiKey,
        referenceImages,
      };
      const { result: url, journalId, handle } = await runJournaled<string>(
        ctx,
        {
          provider,
          apiType: "image",
          modelKey,
          // descriptor 用 mediaId（唔係 normalize 完嘅 data URI）—— 平、而且
          // 跨 worker 重啟一定砌得返同一個 hash。
          descriptor: { modelKey, prompt: req.prompt, negativePrompt: req.negativePrompt, aspectRatio: req.aspectRatio, resolution, refs },
        },
        {
          submit: () => (provider === "fal" ? falImageSubmit(args) : atlasImageSubmit(args)),
          poll: async (h) => (provider === "fal" ? (await falPoll(h, apiKey, "image")).url : (await atlasPoll(h, apiKey)).url),
        },
      );
      const media = await createMediaFromUrl({ userId: ctx.userId, url, keyPrefix: req.keyPrefix });
      await markConsumed(journalId, media.id);
      return { media, quantity: 1, unit: "image", providerRequestId: handle.requestId };
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

// 尾幀能力閘：模型冇聲明 supportsEndFrame 就唔傳，照生片。刻意唔 throw —— 尾幀係
// 錦上添花嘅連戲手段，唔值得因為換咗個 model 就令成批鏡頭 fail。留 warn 等切模型之後
// 「點解啲片突然接唔順」查得返。
async function getOutboundEndImageUrl(modelKey: string, mediaId: string): Promise<string | null> {
  if (!getCapabilities(modelKey)?.supportsEndFrame) {
    console.warn(`[generate-media] ${modelKey} 冇聲明 supportsEndFrame，尾幀錨定已跳過`);
    return null;
  }
  return getOutboundImageUrl(mediaId);
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
      const endImageUrl = req.endImageMediaId ? await getOutboundEndImageUrl(req.modelKey, req.endImageMediaId) : null;
      const args = {
        modelId,
        prompt: req.prompt,
        imageUrl: imageUrl ?? undefined,
        endImageUrl: endImageUrl ?? undefined,
        durationSec: req.durationSec,
        aspectRatio: req.aspectRatio,
        apiKey,
      };
      const { result: url, journalId, handle } = await runJournaled<string>(
        ctx,
        {
          provider,
          apiType: "video",
          modelKey: req.modelKey,
          descriptor: {
            modelKey: req.modelKey,
            prompt: req.prompt,
            sourceImageMediaId: req.sourceImageMediaId ?? null,
            endImageMediaId: req.endImageMediaId ?? null,
            durationSec: req.durationSec,
            aspectRatio: req.aspectRatio,
          },
        },
        {
          submit: () => (provider === "fal" ? falVideoSubmit(args) : atlasVideoSubmit(args)),
          poll: async (h) => (provider === "fal" ? (await falPoll(h, apiKey, "video")).url : (await atlasPoll(h, apiKey)).url),
        },
      );
      const media = await createMediaFromUrl({ userId: ctx.userId, url, keyPrefix: req.keyPrefix });
      await markConsumed(journalId, media.id);
      return { media, quantity: req.durationSec, unit: "second", providerRequestId: handle.requestId };
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
      const referenceAudioUrl =
        req.voice?.kind === "ref" ? (await getMediaUrl(req.voice.mediaId)) ?? undefined : undefined;
      const presetVoiceId = req.voice?.kind === "preset" ? req.voice.presetId : undefined;
      const args = {
        modelId,
        text: req.text,
        referenceAudioUrl,
        presetVoiceId,
        emotion: req.emotion,
        emotionStrength: req.emotionStrength,
        apiKey,
      };
      const { result: url, journalId, handle } = await runJournaled<string>(
        ctx,
        {
          provider,
          apiType: "tts",
          modelKey: req.modelKey,
          // descriptor 係續接用嘅指紋：任何改變合成結果嘅輸入都要入面，
          // 否則改咗音色／情緒之後會續返舊 request 攞返舊聲。
          descriptor: {
            modelKey: req.modelKey,
            text: req.text,
            voice: req.voice ?? null,
            emotion: req.emotion ?? null,
            emotionStrength: req.emotionStrength ?? null,
          },
        },
        {
          submit: () => (provider === "fal" ? falTtsSubmit(args) : atlasTtsSubmit(args)),
          poll: async (h) => (provider === "fal" ? (await falPoll(h, apiKey, "tts")).url : (await atlasPoll(h, apiKey)).url),
        },
      );
      const media = await createMediaFromUrl({ userId: ctx.userId, url, keyPrefix: req.keyPrefix });
      await markConsumed(journalId, media.id);
      return { media, quantity: req.text.length, unit: "character", providerRequestId: handle.requestId };
    }
    if (provider === "template") {
      const referenceAudioUrl =
        req.voice?.kind === "ref" ? (await getMediaUrl(req.voice.mediaId)) ?? "" : "";
      const media = await runTemplateProvider(ctx, "tts", modelId, req.keyPrefix, {
        text: req.text,
        voice_id: req.voice?.kind === "preset" ? req.voice.presetId : "",
        reference_audio_url: referenceAudioUrl,
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
