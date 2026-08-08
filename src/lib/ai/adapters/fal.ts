// fal.ai media adapter — Queue API (docs/tech/03-provider-layer.md).
// Only generate-media.ts may import this (guard: no-ai-bypass).
//
// Flow: submit `POST https://queue.fal.run/{modelId}` with `Authorization: Key {k}`
// → {request_id}; then poll `GET .../requests/{id}/status` until COMPLETED, and
// fetch `.../requests/{id}` for the result payload. 429/5xx → retryable AiError;
// other 4xx → terminal. The app layer (BullMQ) owns backoff/retry (CLAUDE.md #6).
//
// Submit 同 poll 係分開 export 嘅（falImageSubmit / falPoll …），因為
// src/lib/ai/request-journal.ts 要喺兩者之間插一步「把 request_id 寫落 DB」——
// worker 中途死咗都可以攞返同一個 handle 續 poll，唔會蒸發已開嘅 GPU 資源。
// falImage/falVideo/falTts 保留成薄 wrapper（submit + poll），畀無 task 上下文
// 嘅呼叫（smoke script／測試）沿用。
import { AiError } from "@/lib/ai/types";

const QUEUE_BASE = "https://queue.fal.run";
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1_000;
const FETCH_TIMEOUT_MS = 60_000; // per-request cap — a stalled TCP conn must not hang a worker slot forever

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// fetch with a hard per-request timeout; a timed-out request is retryable.
async function timedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new AiError("FAL_FETCH_TIMEOUT", `fal request to ${url} timed out`, true);
    }
    throw new AiError("FAL_FETCH_ERROR", String(err instanceof Error ? err.message : err), true);
  }
}

// fal image_size named presets; explicit {width,height} where a portrait short-form
// ratio has no named preset. Videos use aspect_ratio strings directly.
const IMAGE_SIZE: Record<string, string | { width: number; height: number }> = {
  "9:16": "portrait_16_9",
  "16:9": "landscape_16_9",
  "1:1": "square_hd",
  "3:4": "portrait_4_3",
  "4:3": "landscape_4_3",
};

function imageSizeFor(aspectRatio: string): string | { width: number; height: number } {
  return IMAGE_SIZE[aspectRatio] ?? "portrait_16_9";
}

// Seedream takes explicit pixel dimensions (960²–4096² total pixels, per its
// OpenAPI schema) instead of a resolution enum — map the tier to a long side and
// derive the short side from the aspect ratio, clamped to the documented minimum.
const RESOLUTION_LONG_SIDE: Record<string, number> = { "1K": 1024, "2K": 2048, "4K": 4096 };

function imageSizeForResolution(aspectRatio: string, resolution: string): { width: number; height: number } | null {
  const long = RESOLUTION_LONG_SIDE[resolution];
  const m = /^(\d+):(\d+)$/.exec(aspectRatio);
  if (!long || !m) return null;
  const [w, h] = [Number(m[1]), Number(m[2])];
  const short = Math.max(960, Math.round((long * Math.min(w, h)) / Math.max(w, h) / 8) * 8);
  return w >= h ? { width: long, height: short } : { width: short, height: long };
}

// Submit uses the full model path (`fal-ai/index-tts-2/text-to-speech`), but
// status/result URLs must use the APP ROOT only (`fal-ai/index-tts-2`) —
// polling with the subpath returns 405. Verified against the live API.
function appRoot(modelId: string): string {
  return modelId.split("/").slice(0, 2).join("/");
}

function classify(status: number, body: string): AiError {
  // `no_media_generated` (HTTP 422) is a TRANSIENT hiccup of Gemini-family image
  // models — they occasionally refuse to produce output even for benign prompts,
  // and the same request succeeds on retry. Treat it as retryable so the app-layer
  // backoff re-submits (bounded by maxAttempts, so a genuinely unsafe prompt still
  // goes terminal after a few tries).
  const transient422 = status === 422 && body.includes("no_media_generated");
  const retryable = status === 429 || status >= 500 || transient422;
  const code = transient422 ? "FAL_NO_MEDIA_RETRY" : `HTTP_${status}`;
  return new AiError(code, `fal: ${body.slice(0, 500)}`, retryable);
}

async function submit(modelId: string, apiKey: string, input: Record<string, unknown>): Promise<string> {
  const res = await timedFetch(`${QUEUE_BASE}/${modelId}`, {
    method: "POST",
    headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw classify(res.status, await res.text().catch(() => ""));
  const json = (await res.json()) as { request_id?: string };
  if (!json.request_id) throw new AiError("FAL_NO_REQUEST_ID", "fal submit returned no request_id", true);
  return json.request_id;
}

interface FalStatus {
  status?: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | string;
  error?: unknown;
}

async function pollUntilDone(modelId: string, requestId: string, apiKey: string): Promise<void> {
  const headers = { Authorization: `Key ${apiKey}` };
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const res = await timedFetch(`${QUEUE_BASE}/${appRoot(modelId)}/requests/${requestId}/status`, { headers });
    if (!res.ok) throw classify(res.status, await res.text().catch(() => ""));
    const json = (await res.json()) as FalStatus;
    if (json.status === "COMPLETED") return;
    if (json.status === "FAILED") {
      throw new AiError("FAL_FAILED", `fal job failed: ${JSON.stringify(json.error ?? {}).slice(0, 500)}`);
    }
    if (Date.now() >= deadline) throw new AiError("FAL_TIMEOUT", `fal job ${requestId} timed out`, true);
    await sleep(POLL_INTERVAL_MS);
  }
}

async function fetchResult(modelId: string, requestId: string, apiKey: string): Promise<Record<string, unknown>> {
  const res = await timedFetch(`${QUEUE_BASE}/${appRoot(modelId)}/requests/${requestId}`, {
    headers: { Authorization: `Key ${apiKey}` },
  });
  if (!res.ok) throw classify(res.status, await res.text().catch(() => ""));
  return (await res.json()) as Record<string, unknown>;
}

// 一條在途 fal request 嘅完整座標。endpoint 係 submit 落去嗰個（可能經 /edit
// swap），poll／cancel 都要用返佢嚟計 app root，所以要一齊持久化。
export interface FalHandle {
  endpoint: string;
  requestId: string;
}

export type FalApiType = "image" | "video" | "tts";

// 輸出 URL 喺 result payload 邊個 key —— 由 apiType 推導，唔使持久化。
const URL_KEYS: Record<FalApiType, string[]> = {
  image: ["images", "image"],
  video: ["video"],
  tts: ["audio"],
};

// 續 poll 一條已知 handle：等到 COMPLETED，攞 result payload 同輸出 URL。
// 呢隻 function 係冪等嘅 —— 同一個 requestId poll 幾多次都得，所以斷線重入
// 完全安全。
export async function falPoll(
  handle: FalHandle,
  apiKey: string,
  apiType: FalApiType,
): Promise<{ result: Record<string, unknown>; url: string }> {
  await pollUntilDone(handle.endpoint, handle.requestId, apiKey);
  const result = await fetchResult(handle.endpoint, handle.requestId, apiKey);
  return { result, url: firstUrl(result, URL_KEYS[apiType]) };
}

// 主動取消一條在途 request（task 被取消／終局失敗時用）。fal 對已完成嘅
// request 會回 4xx —— 呼叫方當 best-effort 處理，唔好因為佢 fail 而阻塞。
export async function falCancel(handle: FalHandle, apiKey: string): Promise<void> {
  const res = await timedFetch(`${QUEUE_BASE}/${appRoot(handle.endpoint)}/requests/${handle.requestId}/cancel`, {
    method: "PUT",
    headers: { Authorization: `Key ${apiKey}` },
  });
  if (!res.ok) throw classify(res.status, await res.text().catch(() => ""));
}

// fal result payloads vary by model; images live under `images[]`, video under
// `video`, audio under `audio`. Pull the first url present, else terminal.
function firstUrl(result: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = result[key];
    if (typeof v === "string") return v;
    if (v && typeof v === "object" && typeof (v as { url?: unknown }).url === "string") {
      return (v as { url: string }).url;
    }
    if (Array.isArray(v) && v[0]) {
      const first = v[0];
      if (typeof first === "string") return first;
      if (typeof (first as { url?: unknown }).url === "string") return (first as { url: string }).url;
    }
  }
  throw new AiError("FAL_NO_OUTPUT", `fal result missing output url (looked in: ${keys.join(", ")})`);
}

async function runQueue(
  modelId: string,
  apiKey: string,
  input: Record<string, unknown>,
  apiType: FalApiType,
): Promise<{ result: Record<string, unknown>; url: string; requestId: string }> {
  const requestId = await submit(modelId, apiKey, input);
  const { result, url } = await falPoll({ endpoint: modelId, requestId }, apiKey, apiType);
  return { result, url, requestId };
}

export interface FalImageArgs {
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: string;
  resolution?: string; // "1K" | "2K" | "4K" — pre-validated against capabilities upstream
  apiKey: string;
  referenceImages?: string[]; // data-URIs; when present → image-to-image (character consistency)
}

// Reference/edit endpoint per model. fal exposes an `/edit` variant that accepts
// `image_urls` for nano-banana, nano-banana-pro, and Seedream. The text-to-image
// suffix (or /base) is swapped for /edit; a bare model id gets /edit appended.
function editEndpointFor(modelId: string): string {
  if (modelId.endsWith("/edit")) return modelId;
  for (const suffix of ["/text-to-image", "/image-to-image", "/base"]) {
    if (modelId.endsWith(suffix)) return modelId.slice(0, -suffix.length) + "/edit";
  }
  return `${modelId}/edit`;
}

// 由 args 砌出 (endpoint, input) —— submit 同 wrapper 共用同一份映射邏輯。
function falImageRequest(args: FalImageArgs): { endpoint: string; input: Record<string, unknown> } {
  const refs = args.referenceImages ?? [];
  const hasRefs = refs.length > 0;

  // Size fields differ per family (verified against fal's OpenAPI schemas):
  // nano-banana* take `aspect_ratio` (+ `resolution` enum on -pro, both t2i and
  // /edit paths); Seedream and the generic rest take `image_size`. Sending
  // image_size to nano-banana is silently ignored — aspect_ratio is mandatory.
  const isNanoBanana = args.modelId.includes("nano-banana");
  const sizeInput: Record<string, unknown> = isNanoBanana
    ? { aspect_ratio: args.aspectRatio, ...(args.resolution ? { resolution: args.resolution } : {}) }
    : {
        image_size:
          (args.resolution ? imageSizeForResolution(args.aspectRatio, args.resolution) : null) ??
          imageSizeFor(args.aspectRatio),
      };

  const input: Record<string, unknown> = {
    prompt: args.prompt,
    ...sizeInput,
    ...(hasRefs ? { image_urls: refs } : {}), // edit/reference path — model conditions on these images
  };
  if (args.negativePrompt) input.negative_prompt = args.negativePrompt;

  return { endpoint: hasRefs ? editEndpointFor(args.modelId) : args.modelId, input };
}

export async function falImageSubmit(args: FalImageArgs): Promise<FalHandle> {
  const { endpoint, input } = falImageRequest(args);
  return { endpoint, requestId: await submit(endpoint, args.apiKey, input) };
}

export async function falImage(args: FalImageArgs): Promise<{ url: string; providerRequestId: string }> {
  const { endpoint, input } = falImageRequest(args);
  const { url, requestId } = await runQueue(endpoint, args.apiKey, input, "image");
  return { url, providerRequestId: requestId };
}

export interface FalVideoArgs {
  modelId: string;
  prompt: string;
  imageUrl?: string;
  endImageUrl?: string;
  durationSec: number;
  aspectRatio: string;
  apiKey: string;
}

function falVideoRequest(args: FalVideoArgs): { endpoint: string; input: Record<string, unknown> } {
  const input: Record<string, unknown> = {
    prompt: args.prompt,
    aspect_ratio: args.aspectRatio,
    duration: String(args.durationSec),
    // Motion-realism guard (waoowaoo's lesson): a short negative prompt + lower
    // guidance keeps i2v from morphing/distorting faces. Kling supports cfg_scale.
    negative_prompt: "blur, distort, morph, deformed face, extra limbs, low quality, flickering",
  };
  if (args.modelId.includes("kling")) input.cfg_scale = 0.5;
  if (args.imageUrl) input.image_url = args.imageUrl;
  // 尾幀（首尾幀）：Kling 收 `tail_image_url`。能力閘喺 generate-media.ts —— 現時
  // standards/capabilities.json 冇任何 fal model 標 supportsEndFrame（v3/standard
  // 未核實過），所以呢條實際上未通電；核實到邊個 fal model 支援就標旗開通。
  if (args.endImageUrl) input.tail_image_url = args.endImageUrl;
  return { endpoint: args.modelId, input };
}

export async function falVideoSubmit(args: FalVideoArgs): Promise<FalHandle> {
  const { endpoint, input } = falVideoRequest(args);
  return { endpoint, requestId: await submit(endpoint, args.apiKey, input) };
}

export async function falVideo(args: FalVideoArgs): Promise<{ url: string; providerRequestId: string }> {
  const { endpoint, input } = falVideoRequest(args);
  const { url, requestId } = await runQueue(endpoint, args.apiKey, input, "video");
  return { url, providerRequestId: requestId };
}

export interface FalTtsArgs {
  modelId: string;
  text: string;
  // 聲音克隆嘅參考音（ref 模式）
  referenceAudioUrl?: string;
  // provider 內置音色 id（preset 模式）
  presetVoiceId?: string;
  // voice_analyze 標註嘅中文情緒詞 + 強度（已喺 app 層封頂 0.5）
  emotion?: string;
  emotionStrength?: number;
  apiKey: string;
}

// 中文情緒詞 → provider 情緒枚舉。voice_analyze 出嘅係中文詞（平靜／喜悅／
// 憤怒／悲傷／驚訝／恐懼…），兩家 provider 各有各嘅英文枚舉，喺呢度收窄。
// 對唔上就唔傳 —— 亂傳一個近似情緒，衰過唔傳。
const EMOTION_ZH: { match: RegExp; minimax: string; index: string }[] = [
  { match: /喜悅|開心|高興|歡|喜|笑/, minimax: "happy", index: "happy" },
  { match: /憤怒|生氣|怒|火/, minimax: "angry", index: "angry" },
  { match: /悲傷|難過|傷心|哀|悲/, minimax: "sad", index: "sad" },
  { match: /驚訝|震驚|愕/, minimax: "surprised", index: "surprised" },
  { match: /恐懼|害怕|驚恐|畏/, minimax: "fearful", index: "afraid" },
  { match: /厭惡|嫌惡|反感/, minimax: "disgusted", index: "disgusted" },
  { match: /平靜|冷靜|淡/, minimax: "neutral", index: "calm" },
];

function emotionFor(emotion: string | undefined, key: "minimax" | "index"): string | null {
  if (!emotion) return null;
  return EMOTION_ZH.find((e) => e.match.test(emotion))?.[key] ?? null;
}

// 每家 TTS 嘅 request body 完全唔同名 —— index-tts-2 收 `prompt`＋`audio_url`
// （文字叫 prompt、參考音必填），minimax 收 `text`＋`voice_setting.voice_id`。
// 之前一律送 `{ text, reference_audio_url }`：對 minimax 嚟講 voice 欄位根本
// 唔存在，於是每一句都跌返佢預設嘅 Wise_Woman —— 就係「全部角色同一把聲」。
function falTtsRequest(args: FalTtsArgs): { endpoint: string; input: Record<string, unknown> } {
  if (args.modelId.includes("index-tts-2")) {
    const input: Record<string, unknown> = { prompt: args.text };
    if (args.referenceAudioUrl) input.audio_url = args.referenceAudioUrl;
    const emo = emotionFor(args.emotion, "index");
    if (emo && typeof args.emotionStrength === "number" && args.emotionStrength > 0) {
      input.emotional_strengths = { [emo]: args.emotionStrength };
    }
    return { endpoint: args.modelId, input };
  }
  if (args.modelId.includes("minimax")) {
    const voiceSetting: Record<string, unknown> = {};
    if (args.presetVoiceId) voiceSetting.voice_id = args.presetVoiceId;
    const emo = emotionFor(args.emotion, "minimax");
    if (emo) voiceSetting.emotion = emo;
    const input: Record<string, unknown> = { text: args.text };
    if (Object.keys(voiceSetting).length > 0) input.voice_setting = voiceSetting;
    return { endpoint: args.modelId, input };
  }
  // 未知 TTS 模型：照舊送最通用嘅一組，唔好因為冇對過就 fail。
  const input: Record<string, unknown> = { text: args.text };
  if (args.referenceAudioUrl) input.reference_audio_url = args.referenceAudioUrl;
  if (args.presetVoiceId) input.voice_id = args.presetVoiceId;
  return { endpoint: args.modelId, input };
}

export async function falTtsSubmit(args: FalTtsArgs): Promise<FalHandle> {
  const { endpoint, input } = falTtsRequest(args);
  return { endpoint, requestId: await submit(endpoint, args.apiKey, input) };
}

// duration field varies: index-tts-2 `duration` (s), minimax `duration_ms`
export function falTtsSeconds(result: Record<string, unknown>): number | undefined {
  if (typeof result.duration === "number") return result.duration;
  if (typeof result.duration_ms === "number") return result.duration_ms / 1000;
  return undefined;
}

export async function falTts(args: FalTtsArgs): Promise<{ url: string; seconds?: number; providerRequestId: string }> {
  const { endpoint, input } = falTtsRequest(args);
  const { result, url, requestId } = await runQueue(endpoint, args.apiKey, input, "tts");
  return { url, seconds: falTtsSeconds(result), providerRequestId: requestId };
}
