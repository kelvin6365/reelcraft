import { afterEach, describe, expect, it, vi } from "vitest";
import { falImage, falVideo, falTts } from "@/lib/ai/adapters/fal";
import { openrouterAdapter } from "@/lib/ai/adapters/openrouter";
import { priceMedia, priceText } from "@/lib/ai/capabilities";
import { AiError } from "@/lib/ai/types";

// --- fetch mock helpers -------------------------------------------------
// A tiny Response stand-in — only the bits the adapters touch (ok/status/json/text).
function res(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Route fal Queue API calls by URL shape: POST submit / GET status / GET result.
function stubFalQueue(opts: { requestId?: string; result: Record<string, unknown> }) {
  const requestId = opts.requestId ?? "req-123";
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === "POST") return res(200, { request_id: requestId });
    if (u.endsWith("/status")) return res(200, { status: "COMPLETED" });
    return res(200, opts.result);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fal adapter — Queue submit→poll→completed", () => {
  it("falImage submits, polls, and returns the first image url", async () => {
    const fetchMock = stubFalQueue({ result: { images: [{ url: "https://cdn.fal/out.png" }] } });

    const out = await falImage({
      modelId: "fal-ai/nano-banana",
      prompt: "a cat",
      aspectRatio: "9:16",
      apiKey: "k",
    });

    expect(out.url).toBe("https://cdn.fal/out.png");
    expect(out.providerRequestId).toBe("req-123");

    // submit call: correct queue URL + `Key` auth header + mapped image_size
    const [submitUrl, submitInit] = fetchMock.mock.calls[0];
    expect(String(submitUrl)).toBe("https://queue.fal.run/fal-ai/nano-banana");
    expect(submitInit?.method).toBe("POST");
    expect((submitInit?.headers as Record<string, string>).Authorization).toBe("Key k");
    expect(JSON.parse(submitInit?.body as string)).toMatchObject({
      prompt: "a cat",
      image_size: "portrait_16_9",
    });
  });

  it("falVideo sends a motion negative prompt and cfg_scale for Kling", async () => {
    const fetchMock = stubFalQueue({ result: { video: { url: "https://cdn.fal/v.mp4" } } });
    await falVideo({
      modelId: "fal-ai/kling-video/v3/standard/image-to-video",
      prompt: "the woman pushes the door open, slow push in",
      imageUrl: "https://cdn/x.png",
      durationSec: 5,
      aspectRatio: "9:16",
      apiKey: "k",
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.negative_prompt).toContain("morph");
    expect(body.cfg_scale).toBe(0.5);
    expect(body.image_url).toBe("https://cdn/x.png");
  });

  it("falVideo omits cfg_scale for non-Kling models", async () => {
    const fetchMock = stubFalQueue({ result: { video: { url: "https://cdn.fal/v.mp4" } } });
    await falVideo({ modelId: "fal-ai/veo3.1/image-to-video", prompt: "x", imageUrl: "https://cdn/x.png", durationSec: 5, aspectRatio: "9:16", apiKey: "k" });
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.cfg_scale).toBeUndefined();
    expect(body.negative_prompt).toBeDefined(); // negative prompt still applied
  });

  it("falImage with references switches to the /edit endpoint and sends image_urls", async () => {
    const fetchMock = stubFalQueue({ result: { images: [{ url: "https://cdn.fal/ref-out.png" }] } });
    const refs = ["data:image/jpeg;base64,AAA", "data:image/jpeg;base64,BBB"];

    const out = await falImage({
      modelId: "fal-ai/nano-banana",
      prompt: "林知夏 pushing the cafe door",
      aspectRatio: "9:16",
      apiKey: "k",
      referenceImages: refs,
    });

    expect(out.url).toBe("https://cdn.fal/ref-out.png");
    const [submitUrl, submitInit] = fetchMock.mock.calls[0];
    expect(String(submitUrl)).toBe("https://queue.fal.run/fal-ai/nano-banana/edit"); // reference/edit endpoint
    const body = JSON.parse(submitInit?.body as string);
    expect(body.image_urls).toEqual(refs); // references in image_urls
    expect(body.image_size).toBeUndefined(); // no text-to-image sizing when conditioning on refs
    // status/result polling uses the app root, not the /edit subpath
    expect(String(fetchMock.mock.calls[1][0])).toContain("/fal-ai/nano-banana/requests/");
  });

  it("derives the /edit endpoint per model (pro, seedream text-to-image)", async () => {
    for (const [modelId, expected] of [
      ["fal-ai/nano-banana-pro", "https://queue.fal.run/fal-ai/nano-banana-pro/edit"],
      ["fal-ai/bytedance/seedream/v4/text-to-image", "https://queue.fal.run/fal-ai/bytedance/seedream/v4/edit"],
    ] as const) {
      const fetchMock = stubFalQueue({ result: { images: [{ url: "https://cdn.fal/o.png" }] } });
      await falImage({ modelId, prompt: "x", aspectRatio: "9:16", apiKey: "k", referenceImages: ["data:image/jpeg;base64,AAA"] });
      expect(String(fetchMock.mock.calls[0][0])).toBe(expected);
    }
  });

  it("falVideo passes image_url + aspect_ratio and reads result.video.url", async () => {
    const fetchMock = stubFalQueue({ result: { video: { url: "https://cdn.fal/out.mp4" } } });

    const out = await falVideo({
      modelId: "fal-ai/kling-video/v3/standard/image-to-video",
      prompt: "pan across",
      imageUrl: "https://signed/frame.png",
      durationSec: 5,
      aspectRatio: "9:16",
      apiKey: "k",
    });

    expect(out.url).toBe("https://cdn.fal/out.mp4");
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body).toMatchObject({ aspect_ratio: "9:16", duration: "5", image_url: "https://signed/frame.png" });
  });

  it("falTts returns url and optional seconds from result.duration", async () => {
    stubFalQueue({ result: { audio: { url: "https://cdn.fal/out.m4a" }, duration: 3.5 } });

    const out = await falTts({ modelId: "fal-ai/index-tts-2/text-to-speech", text: "hello", apiKey: "k" });

    expect(out.url).toBe("https://cdn.fal/out.m4a");
    expect(out.seconds).toBe(3.5);
  });
});

describe("fal adapter — error classification", () => {
  it("classifies 429 on submit as a retryable AiError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(429, "rate limited")));

    const err = await falImage({ modelId: "m", prompt: "x", aspectRatio: "9:16", apiKey: "k" }).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe("HTTP_429");
    expect((err as AiError).retryable).toBe(true);
  });

  it("classifies 400 on submit as a terminal AiError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(400, "bad request")));

    const err = await falImage({ modelId: "m", prompt: "x", aspectRatio: "9:16", apiKey: "k" }).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe("HTTP_400");
    expect((err as AiError).retryable).toBe(false);
  });

  it("treats a 422 no_media_generated as RETRYABLE (transient Gemini-image hiccup)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(422, { detail: [{ type: "no_media_generated", msg: "..." }] })));

    const err = await falImage({ modelId: "m", prompt: "x", aspectRatio: "9:16", apiKey: "k" }).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe("FAL_NO_MEDIA_RETRY");
    expect((err as AiError).retryable).toBe(true);
  });

  it("still treats a plain 422 (other reasons) as terminal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(422, { detail: "invalid image_size" })));

    const err = await falImage({ modelId: "m", prompt: "x", aspectRatio: "9:16", apiKey: "k" }).catch((e) => e);
    expect((err as AiError).code).toBe("HTTP_422");
    expect((err as AiError).retryable).toBe(false);
  });

  it("raises FAILED status as a terminal AiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (init?.method === "POST") return res(200, { request_id: "r" });
        return res(200, { status: "FAILED", error: { message: "nsfw" } });
      }),
    );

    const err = await falImage({ modelId: "m", prompt: "x", aspectRatio: "9:16", apiKey: "k" }).catch((e) => e);
    expect((err as AiError).code).toBe("FAL_FAILED");
    expect((err as AiError).retryable).toBe(false);
  });
});

// --- openrouter usage/cost capture --------------------------------------
const OR_REQ = { modelKey: "openrouter::google/gemini-2.5-flash" as const, messages: [{ role: "user" as const, content: "hi" }] };

function orResponse(usage: unknown) {
  return res(200, { id: "gen-1", choices: [{ message: { content: "ok" } }], usage });
}

describe("openrouter adapter — real cost + token detail", () => {
  it("requests usage accounting and maps real cost + cached/reasoning tokens", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      orResponse({
        prompt_tokens: 100,
        completion_tokens: 40,
        cost: 0.00012,
        prompt_tokens_details: { cached_tokens: 60 },
        completion_tokens_details: { reasoning_tokens: 10 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await openrouterAdapter.complete(OR_REQ, "k");
    expect(out.usage).toEqual({
      inputTokens: 100,
      outputTokens: 40,
      cachedInputTokens: 60,
      reasoningTokens: 10,
      providerCostUsd: 0.00012,
    });
    // request body must opt into usage accounting
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.usage).toEqual({ include: true });
  });

  it("sums BYOK upstream_inference_cost into providerCostUsd", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => orResponse({ prompt_tokens: 1, completion_tokens: 1, cost: 0.00001, cost_details: { upstream_inference_cost: 0.0002 } })));
    const out = await openrouterAdapter.complete(OR_REQ, "k");
    expect(out.usage.providerCostUsd).toBeCloseTo(0.00021, 10);
  });

  it("leaves providerCostUsd undefined when the provider reports no cost", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => orResponse({ prompt_tokens: 5, completion_tokens: 5 })));
    const out = await openrouterAdapter.complete(OR_REQ, "k");
    expect(out.usage.providerCostUsd).toBeUndefined();
    expect(out.usage.cachedInputTokens).toBeUndefined();
  });

  it("treats cost 0 as a real value (free models)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => orResponse({ prompt_tokens: 5, completion_tokens: 5, cost: 0 })));
    const out = await openrouterAdapter.complete(OR_REQ, "k");
    expect(out.usage.providerCostUsd).toBe(0);
  });

  it("maps malformed cost values to undefined instead of failing the call", async () => {
    for (const bad of ["0.1", -1, NaN, null]) {
      vi.stubGlobal("fetch", vi.fn(async () => orResponse({ prompt_tokens: 1, completion_tokens: 1, cost: bad })));
      const out = await openrouterAdapter.complete(OR_REQ, "k");
      expect(out.usage.providerCostUsd).toBeUndefined();
      expect(out.text).toBe("ok"); // generation itself still succeeds
    }
  });
});

describe("pricing snapshot from the catalog", () => {
  it("prices flat media as perUnit × quantity", () => {
    const p = priceMedia("fal::fal-ai/kling-video/v3/standard/image-to-video", 5);
    expect(p).not.toBeNull();
    expect(p!.unitPriceSnapshot).toBe(0.28);
    expect(p!.estCostUsd).toBeCloseTo(1.4, 6);
  });

  it("prices images per unit (quantity 1)", () => {
    const p = priceMedia("fal::fal-ai/nano-banana", 1);
    expect(p!.estCostUsd).toBeCloseTo(0.039, 6);
  });

  it("blends text input/output per-MTok rates", () => {
    const p = priceText("openrouter::anthropic/claude-sonnet-4.5", 1_000_000, 1_000_000);
    expect(p!.estCostUsd).toBeCloseTo(18, 6); // 3 + 15
  });

  it("returns null for an unknown modelKey (SHADOW spirit — never throws)", () => {
    expect(priceMedia("fal::does-not-exist", 5)).toBeNull();
    expect(priceText("openrouter::does-not-exist", 100, 100)).toBeNull();
  });

  it("does not price media with a text lookup or vice-versa", () => {
    expect(priceMedia("openrouter::anthropic/claude-sonnet-4.5", 1)).toBeNull();
    expect(priceText("fal::fal-ai/nano-banana", 1, 1)).toBeNull();
  });
});
