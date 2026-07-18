// fal.ai media adapter — Queue API (docs/tech/03-provider-layer.md).
// Only generate-media.ts may import this (guard: no-ai-bypass).
//
// Flow: submit `POST https://queue.fal.run/{modelId}` with `Authorization: Key {k}`
// → {request_id}; then poll `GET .../requests/{id}/status` until COMPLETED, and
// fetch `.../requests/{id}` for the result payload. 429/5xx → retryable AiError;
// other 4xx → terminal. The app layer (BullMQ) owns backoff/retry (CLAUDE.md #6).
import { AiError } from "@/lib/ai/types";

const QUEUE_BASE = "https://queue.fal.run";
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

function classify(status: number, body: string): AiError {
  const retryable = status === 429 || status >= 500;
  return new AiError(`HTTP_${status}`, `fal: ${body.slice(0, 500)}`, retryable);
}

async function submit(modelId: string, apiKey: string, input: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${QUEUE_BASE}/${modelId}`, {
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
    const res = await fetch(`${QUEUE_BASE}/${modelId}/requests/${requestId}/status`, { headers });
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
  const res = await fetch(`${QUEUE_BASE}/${modelId}/requests/${requestId}`, {
    headers: { Authorization: `Key ${apiKey}` },
  });
  if (!res.ok) throw classify(res.status, await res.text().catch(() => ""));
  return (await res.json()) as Record<string, unknown>;
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
  urlKeys: string[],
): Promise<{ result: Record<string, unknown>; url: string; requestId: string }> {
  const requestId = await submit(modelId, apiKey, input);
  await pollUntilDone(modelId, requestId, apiKey);
  const result = await fetchResult(modelId, requestId, apiKey);
  return { result, url: firstUrl(result, urlKeys), requestId };
}

export interface FalImageArgs {
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: string;
  apiKey: string;
}

export async function falImage(args: FalImageArgs): Promise<{ url: string; providerRequestId: string }> {
  const input: Record<string, unknown> = {
    prompt: args.prompt,
    image_size: imageSizeFor(args.aspectRatio),
  };
  if (args.negativePrompt) input.negative_prompt = args.negativePrompt;
  const { url, requestId } = await runQueue(args.modelId, args.apiKey, input, ["images", "image"]);
  return { url, providerRequestId: requestId };
}

export interface FalVideoArgs {
  modelId: string;
  prompt: string;
  imageUrl?: string;
  durationSec: number;
  aspectRatio: string;
  apiKey: string;
}

export async function falVideo(args: FalVideoArgs): Promise<{ url: string; providerRequestId: string }> {
  const input: Record<string, unknown> = {
    prompt: args.prompt,
    aspect_ratio: args.aspectRatio,
    duration: String(args.durationSec),
  };
  if (args.imageUrl) input.image_url = args.imageUrl;
  const { url, requestId } = await runQueue(args.modelId, args.apiKey, input, ["video"]);
  return { url, providerRequestId: requestId };
}

export interface FalTtsArgs {
  modelId: string;
  text: string;
  referenceAudioUrl?: string;
  apiKey: string;
}

export async function falTts(args: FalTtsArgs): Promise<{ url: string; seconds?: number; providerRequestId: string }> {
  const input: Record<string, unknown> = { text: args.text };
  if (args.referenceAudioUrl) input.reference_audio_url = args.referenceAudioUrl;
  const { result, url, requestId } = await runQueue(args.modelId, args.apiKey, input, ["audio"]);
  const seconds = typeof result.duration === "number" ? result.duration : undefined;
  return { url, seconds, providerRequestId: requestId };
}
