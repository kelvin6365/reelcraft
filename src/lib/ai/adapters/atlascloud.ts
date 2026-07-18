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
  apiKey: string;
}

export async function atlasImage(args: AtlasImageArgs): Promise<{ url: string; providerRequestId: string }> {
  const body: Record<string, unknown> = {
    model: args.modelId,
    prompt: args.prompt,
    aspect_ratio: args.aspectRatio,
  };
  if (args.negativePrompt) body.negative_prompt = args.negativePrompt;
  const id = await submit("generateImage", args.apiKey, body);
  const url = await pollForOutput(id, args.apiKey);
  return { url, providerRequestId: id };
}

export interface AtlasVideoArgs {
  modelId: string;
  prompt: string;
  imageUrl?: string;
  durationSec: number;
  aspectRatio: string;
  apiKey: string;
}

export async function atlasVideo(args: AtlasVideoArgs): Promise<{ url: string; providerRequestId: string }> {
  const body: Record<string, unknown> = {
    model: args.modelId,
    prompt: args.prompt,
    aspect_ratio: args.aspectRatio,
    duration: args.durationSec,
  };
  if (args.imageUrl) body.image_url = args.imageUrl;
  const id = await submit("generateVideo", args.apiKey, body);
  const url = await pollForOutput(id, args.apiKey);
  return { url, providerRequestId: id };
}

export interface AtlasTtsArgs {
  modelId: string;
  text: string;
  referenceAudioUrl?: string;
  apiKey: string;
}

// TODO verify against real API when key provisioned — AtlasCloud publishes no TTS
// endpoint yet. Assumed to follow the same submit→poll shape as image/video via a
// `generateSpeech` endpoint; adjust the endpoint name + field mapping once known.
export async function atlasTts(args: AtlasTtsArgs): Promise<{ url: string; seconds?: number; providerRequestId: string }> {
  const body: Record<string, unknown> = { model: args.modelId, text: args.text };
  if (args.referenceAudioUrl) body.reference_audio_url = args.referenceAudioUrl;
  const id = await submit("generateSpeech", args.apiKey, body);
  const url = await pollForOutput(id, args.apiKey);
  return { url, providerRequestId: id };
}
