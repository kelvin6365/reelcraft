// AtlasCloud media adapter — OpenAI-ish aggregator with a submit-then-poll shape
// (docs/tech/03-provider-layer.md). Only generate-media.ts may import this
// (guard: no-ai-bypass).
//
// Endpoints (per https://www.atlascloud.ai/docs, verified 2026-07):
//   POST https://api.atlascloud.ai/api/v1/model/generateImage → {data:{id}}
//   POST https://api.atlascloud.ai/api/v1/model/generateVideo → {data:{id}}
//   GET  https://api.atlascloud.ai/api/v1/model/prediction/{id}
//        → {data:{status:'completed'|'failed', outputs:[url], error}}
//   Auth: `Authorization: Bearer {apiKey}`.
//
// The request/response mapping is isolated in the small functions below so that
// fixing a field name once real keys are provisioned is a one-line change.
// TTS has no documented endpoint yet — falTts is the seam; atlasTts is a
// best-effort guess clearly marked TODO.
import { AiError } from "@/lib/ai/types";

const API_BASE = "https://api.atlascloud.ai/api/v1/model";
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function classify(status: number, body: string): AiError {
  const retryable = status === 429 || status >= 500;
  return new AiError(`HTTP_${status}`, `atlascloud: ${body.slice(0, 500)}`, retryable);
}

async function submit(endpoint: string, apiKey: string, body: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${API_BASE}/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw classify(res.status, await res.text().catch(() => ""));
  const json = (await res.json()) as { data?: { id?: string } };
  const id = json.data?.id;
  if (!id) throw new AiError("ATLAS_NO_PREDICTION_ID", "atlascloud submit returned no prediction id", true);
  return id;
}

interface AtlasPrediction {
  data?: {
    status?: "queued" | "processing" | "completed" | "failed" | string;
    outputs?: unknown[];
    error?: unknown;
  };
}

// 一條在途 atlascloud prediction 嘅座標。`endpoint` 對 poll 嚟講用唔著（prediction
// URL 唔分 api type），但照持久化落 journal，方便對數同將來 cancel endpoint 出咗之後用。
export interface AtlasHandle {
  endpoint: string;
  requestId: string;
}

// 續 poll 一條已知 prediction —— 冪等，斷線重入照 poll 得。
export async function atlasPoll(handle: AtlasHandle, apiKey: string): Promise<{ url: string }> {
  return { url: await pollForOutput(handle.requestId, apiKey) };
}

// AtlasCloud 未有公開嘅 cancel endpoint（2026-08 查過 docs）。留住呢個 seam，
// 令 request-journal 對兩個 provider 一視同仁；出咗 endpoint 補一行 fetch 就得。
export async function atlasCancel(_handle: AtlasHandle, _apiKey: string): Promise<void> {
  throw new AiError("ATLAS_CANCEL_UNSUPPORTED", "atlascloud has no documented cancel endpoint", false);
}

async function pollForOutput(predictionId: string, apiKey: string): Promise<string> {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const res = await fetch(`${API_BASE}/prediction/${predictionId}`, { headers });
    if (!res.ok) throw classify(res.status, await res.text().catch(() => ""));
    const { data } = (await res.json()) as AtlasPrediction;

    if (data?.status === "completed") {
      const url = data.outputs?.[0];
      if (typeof url !== "string") throw new AiError("ATLAS_NO_OUTPUT", "atlascloud completed without an output url");
      return url;
    }
    if (data?.status === "failed") {
      throw new AiError("ATLAS_FAILED", `atlascloud job failed: ${JSON.stringify(data.error ?? {}).slice(0, 500)}`);
    }
    if (Date.now() >= deadline) throw new AiError("ATLAS_TIMEOUT", `atlascloud job ${predictionId} timed out`, true);
    await sleep(POLL_INTERVAL_MS);
  }
}

export interface AtlasImageArgs {
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: string;
  resolution?: string; // "1K" | "2K" | "4K" — pre-validated against capabilities upstream
  apiKey: string;
  // Edit-family models (…/edit) take input images via `images` (1-14 URLs).
  // AtlasCloud documents URLs only — data URIs (local-dev storage) are rejected
  // upstream, so we fail fast with a clear code instead of a cryptic 400.
  referenceImages?: string[];
}

function atlasImageBody(args: AtlasImageArgs): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: args.modelId,
    prompt: args.prompt,
    aspect_ratio: args.aspectRatio,
  };
  if (args.resolution) {
    // Field shape per model family (verified 2026-07 on atlascloud.ai model pages):
    // nano-banana-2 takes a lowercase `resolution` enum ("1k"|"2k"|"4k");
    // seedream-v5.0-pro takes `size: "WIDTH*HEIGHT"`.
    if (args.modelId.includes("nano-banana")) {
      body.resolution = args.resolution.toLowerCase();
    } else if (args.modelId.includes("seedream-v5")) {
      const long = { "1K": 1024, "2K": 2048, "4K": 4096 }[args.resolution];
      const m = /^(\d+):(\d+)$/.exec(args.aspectRatio);
      if (long && m) {
        const [w, h] = [Number(m[1]), Number(m[2])];
        const short = Math.round((long * Math.min(w, h)) / Math.max(w, h) / 8) * 8;
        body.size = w >= h ? `${long}*${short}` : `${short}*${long}`;
      }
    }
  }
  if (args.negativePrompt) body.negative_prompt = args.negativePrompt;
  if (args.referenceImages?.length) {
    if (args.referenceImages.some((u) => u.startsWith("data:"))) {
      throw new AiError(
        "ATLAS_REF_URL_REQUIRED",
        "atlascloud edit models accept reference images as public URLs only — local-dev storage produces data URIs; use a fal image model locally or public storage",
      );
    }
    body.images = args.referenceImages;
  }
  return body;
}

export async function atlasImageSubmit(args: AtlasImageArgs): Promise<AtlasHandle> {
  const endpoint = "generateImage";
  return { endpoint, requestId: await submit(endpoint, args.apiKey, atlasImageBody(args)) };
}

export async function atlasImage(args: AtlasImageArgs): Promise<{ url: string; providerRequestId: string }> {
  const id = await submit("generateImage", args.apiKey, atlasImageBody(args));
  const url = await pollForOutput(id, args.apiKey);
  return { url, providerRequestId: id };
}

export interface AtlasVideoArgs {
  modelId: string;
  prompt: string;
  imageUrl?: string;
  endImageUrl?: string;
  durationSec: number;
  aspectRatio: string;
  apiKey: string;
}

function atlasVideoBody(args: AtlasVideoArgs): Record<string, unknown> {
  // Seedance 2.0 family has its own documented schema (verified 2026-07 at
  // atlascloud.ai/models/bytedance/seedance-2.0/image-to-video): first frame in
  // `image` (URL or data URI), `ratio: "adaptive"` follows the frame's aspect,
  // resolution capped at 720p. Other models keep the legacy generic shape.
  const isSeedance = args.modelId.includes("/seedance-");
  const body: Record<string, unknown> = isSeedance
    ? {
        model: args.modelId,
        prompt: args.prompt,
        duration: Math.round(args.durationSec),
        resolution: "720p",
        ratio: "adaptive",
        generate_audio: false,
        watermark: false,
      }
    : {
        model: args.modelId,
        prompt: args.prompt,
        aspect_ratio: args.aspectRatio,
        duration: args.durationSec,
      };
  if (args.imageUrl) {
    if (isSeedance) body.image = args.imageUrl;
    else body.image_url = args.imageUrl;
  }
  // 尾幀（首尾幀）：Seedance 2.0 全家（mini／fast／正式版）收 optional `last_image`，
  // 條片會由 `image` 過渡到佢。legacy 分支冇呢個參數，多傳會被 provider 拒，所以只喺
  // Seedance 分支寫。能力閘喺 generate-media.ts，行到呢度即係已經確認支援。
  if (args.endImageUrl && isSeedance) body.last_image = args.endImageUrl;
  return body;
}

export async function atlasVideoSubmit(args: AtlasVideoArgs): Promise<AtlasHandle> {
  const endpoint = "generateVideo";
  return { endpoint, requestId: await submit(endpoint, args.apiKey, atlasVideoBody(args)) };
}

export async function atlasVideo(args: AtlasVideoArgs): Promise<{ url: string; providerRequestId: string }> {
  const id = await submit("generateVideo", args.apiKey, atlasVideoBody(args));
  const url = await pollForOutput(id, args.apiKey);
  return { url, providerRequestId: id };
}

export interface AtlasTtsArgs {
  modelId: string;
  text: string;
  referenceAudioUrl?: string;
  presetVoiceId?: string;
  emotion?: string;
  emotionStrength?: number;
  apiKey: string;
}

// TODO verify against real API when key provisioned — AtlasCloud publishes no TTS
// endpoint yet. Assumed to follow the same submit→poll shape as image/video via a
// `generateSpeech` endpoint; adjust the endpoint name + field mapping once known.
function atlasTtsBody(args: AtlasTtsArgs): Record<string, unknown> {
  const body: Record<string, unknown> = { model: args.modelId, text: args.text };
  if (args.referenceAudioUrl) body.reference_audio_url = args.referenceAudioUrl;
  if (args.presetVoiceId) body.voice_id = args.presetVoiceId;
  return body;
}

export async function atlasTtsSubmit(args: AtlasTtsArgs): Promise<AtlasHandle> {
  const endpoint = "generateSpeech";
  return { endpoint, requestId: await submit(endpoint, args.apiKey, atlasTtsBody(args)) };
}

export async function atlasTts(args: AtlasTtsArgs): Promise<{ url: string; seconds?: number; providerRequestId: string }> {
  const id = await submit("generateSpeech", args.apiKey, atlasTtsBody(args));
  const url = await pollForOutput(id, args.apiKey);
  return { url, providerRequestId: id };
}
