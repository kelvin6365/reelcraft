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

    // submit call: correct queue URL + `Key` auth header. nano-banana family
    // takes aspect_ratio (image_size is a Seedream/generic field it ignores).
    const [submitUrl, submitInit] = fetchMock.mock.calls[0];
    expect(String(submitUrl)).toBe("https://queue.fal.run/fal-ai/nano-banana");
    expect(submitInit?.method).toBe("POST");
    expect((submitInit?.headers as Record<string, string>).Authorization).toBe("Key k");
    const submitBody = JSON.parse(submitInit?.body as string);
    expect(submitBody).toMatchObject({ prompt: "a cat", aspect_ratio: "9:16" });
    expect(submitBody.image_size).toBeUndefined();
    expect(submitBody.resolution).toBeUndefined(); // not requested → provider default
  });

  it("falImage maps resolution per family: enum for nano-banana-pro, pixels for Seedream", async () => {
    let fetchMock = stubFalQueue({ result: { images: [{ url: "https://cdn.fal/o.png" }] } });
    await falImage({ modelId: "fal-ai/nano-banana-pro", prompt: "x", aspectRatio: "16:9", resolution: "4K", apiKey: "k" });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toMatchObject({ aspect_ratio: "16:9", resolution: "4K" });

    fetchMock = stubFalQueue({ result: { images: [{ url: "https://cdn.fal/o.png" }] } });
    await falImage({ modelId: "fal-ai/bytedance/seedream/v4/text-to-image", prompt: "x", aspectRatio: "9:16", resolution: "4K", apiKey: "k" });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).image_size).toEqual({ width: 2304, height: 4096 });
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

  // Kling 收 tail_image_url 做尾幀。呢條路徑而家未通電（capabilities.json 冇任何 fal
  // model 標 supportsEndFrame），但參數映射要係啱嘅，核實到就標旗即用。
  it("falVideo passes tail_image_url when an end frame is supplied", async () => {
    const fetchMock = stubFalQueue({ result: { video: { url: "https://cdn.fal/out.mp4" } } });
    await falVideo({
      modelId: "fal-ai/kling-video/v3/standard/image-to-video",
      prompt: "pan across",
      imageUrl: "https://signed/a.png",
      endImageUrl: "https://signed/b.png",
      durationSec: 5,
      aspectRatio: "9:16",
      apiKey: "k",
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.image_url).toBe("https://signed/a.png");
    expect(body.tail_image_url).toBe("https://signed/b.png");
  });

  it("falVideo omits tail_image_url when no end frame is supplied", async () => {
    const fetchMock = stubFalQueue({ result: { video: { url: "https://cdn.fal/out.mp4" } } });
    await falVideo({
      modelId: "fal-ai/kling-video/v3/standard/image-to-video",
      prompt: "x",
      imageUrl: "https://signed/a.png",
      durationSec: 5,
      aspectRatio: "9:16",
      apiKey: "k",
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).tail_image_url).toBeUndefined();
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

// --- atlascloud: seedance schema + edit references ----------------------
import { atlasImage, atlasVideo } from "@/lib/ai/adapters/atlascloud";
import { effectiveImageModelKey } from "@/lib/ai/generate-media";

function stubAtlas(outputUrl = "https://cdn.atlas/out") {
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (init?.method === "POST") return res(200, { data: { id: "pred-1" } });
    return res(200, { data: { status: "completed", outputs: [outputUrl] } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("atlascloud adapter — seedance & edit mappings", () => {
  it("sends the documented seedance i2v schema (image, adaptive ratio, 720p, no audio)", async () => {
    const fetchMock = stubAtlas("https://cdn.atlas/v.mp4");
    await atlasVideo({
      modelId: "bytedance/seedance-2.0-mini/image-to-video",
      prompt: "push in",
      imageUrl: "data:image/png;base64,AAA",
      durationSec: 5,
      aspectRatio: "9:16",
      apiKey: "k",
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body).toMatchObject({
      model: "bytedance/seedance-2.0-mini/image-to-video",
      image: "data:image/png;base64,AAA",
      duration: 5,
      resolution: "720p",
      ratio: "adaptive",
      generate_audio: false,
      watermark: false,
    });
    expect(body.aspect_ratio).toBeUndefined();
    expect(body.image_url).toBeUndefined();
  });

  // 首尾幀錨定：條片由 image 過渡到 last_image，令下一鏡條片可以由同一格開始。
  it("sends last_image for seedance when an end frame is supplied", async () => {
    const fetchMock = stubAtlas("https://cdn.atlas/v.mp4");
    await atlasVideo({
      modelId: "bytedance/seedance-2.0-mini/image-to-video",
      prompt: "push in",
      imageUrl: "https://signed/a.png",
      endImageUrl: "https://signed/b.png",
      durationSec: 5,
      aspectRatio: "9:16",
      apiKey: "k",
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.image).toBe("https://signed/a.png");
    expect(body.last_image).toBe("https://signed/b.png");
  });

  it("omits last_image when no end frame is supplied", async () => {
    const fetchMock = stubAtlas("https://cdn.atlas/v.mp4");
    await atlasVideo({
      modelId: "bytedance/seedance-2.0-mini/image-to-video",
      prompt: "x",
      imageUrl: "https://signed/a.png",
      durationSec: 5,
      aspectRatio: "9:16",
      apiKey: "k",
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).last_image).toBeUndefined();
  });

  // legacy 分支冇 last_image 呢個參數，多傳會被 provider 拒 —— 唔可以順手照傳。
  it("never sends last_image on the legacy (non-seedance) shape", async () => {
    const fetchMock = stubAtlas("https://cdn.atlas/v.mp4");
    await atlasVideo({
      modelId: "kling-v2.0",
      prompt: "x",
      imageUrl: "https://cdn/f.png",
      endImageUrl: "https://cdn/g.png",
      durationSec: 5,
      aspectRatio: "9:16",
      apiKey: "k",
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).last_image).toBeUndefined();
  });

  it("keeps the legacy shape for non-seedance models", async () => {
    const fetchMock = stubAtlas("https://cdn.atlas/v.mp4");
    await atlasVideo({ modelId: "kling-v2.0", prompt: "x", imageUrl: "https://cdn/f.png", durationSec: 5, aspectRatio: "9:16", apiKey: "k" });
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body).toMatchObject({ aspect_ratio: "9:16", image_url: "https://cdn/f.png" });
    expect(body.image).toBeUndefined();
  });

  it("passes reference images to edit models via `images` (URLs)", async () => {
    const fetchMock = stubAtlas();
    await atlasImage({
      modelId: "google/nano-banana-2/edit",
      prompt: "x",
      aspectRatio: "9:16",
      apiKey: "k",
      referenceImages: ["https://signed/a.png", "https://signed/b.png"],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.images).toEqual(["https://signed/a.png", "https://signed/b.png"]);
  });

  it("rejects data-URI references with a clear terminal error (atlas accepts URLs only)", async () => {
    stubAtlas();
    const err = await atlasImage({
      modelId: "google/nano-banana-2/edit",
      prompt: "x",
      aspectRatio: "9:16",
      apiKey: "k",
      referenceImages: ["data:image/jpeg;base64,AAA"],
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe("ATLAS_REF_URL_REQUIRED");
  });
});

describe("effectiveImageModelKey — atlas t2i↔edit sibling swap", () => {
  it("swaps atlas t2i to the edit sibling when refs are present (edit is billed, not t2i)", () => {
    expect(effectiveImageModelKey("atlascloud::google/nano-banana-2/text-to-image", true)).toBe(
      "atlascloud::google/nano-banana-2/edit",
    );
  });

  it("keeps t2i without refs, keeps fal keys untouched, keeps keys without a catalog sibling", () => {
    expect(effectiveImageModelKey("atlascloud::google/nano-banana-2/text-to-image", false)).toBe(
      "atlascloud::google/nano-banana-2/text-to-image",
    );
    expect(effectiveImageModelKey("fal::fal-ai/nano-banana", true)).toBe("fal::fal-ai/nano-banana");
    expect(effectiveImageModelKey("atlascloud::seedream-3.0", true)).toBe("atlascloud::seedream-3.0");
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

  it("throws a retryable AiError when the response was cut at the token limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        res(200, {
          id: "gen-1",
          choices: [{ message: { content: '{"shots":[{"index":1,"lighting":"窗' }, finish_reason: "length" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      ),
    );
    // Silent truncation used to flow straight into repairTruncatedJson and land
    // in the DB as a half-empty pass. Retryable → textCallJson re-rolls it.
    await expect(openrouterAdapter.complete(OR_REQ, "k")).rejects.toMatchObject({
      code: "OUTPUT_TRUNCATED",
      retryable: true,
    });
    await expect(openrouterAdapter.complete(OR_REQ, "k")).rejects.toBeInstanceOf(AiError);
  });

  it("also catches the upstream spelling (Gemini native_finish_reason MAX_TOKENS)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        res(200, { id: "g", choices: [{ message: { content: "{" }, native_finish_reason: "MAX_TOKENS" }], usage: {} }),
      ),
    );
    await expect(openrouterAdapter.complete(OR_REQ, "k")).rejects.toMatchObject({ code: "OUTPUT_TRUNCATED" });
  });

  it("does not treat a normal stop or a missing finish_reason as truncation", async () => {
    for (const choice of [{ message: { content: "ok" }, finish_reason: "stop" }, { message: { content: "ok" } }]) {
      vi.stubGlobal("fetch", vi.fn(async () => res(200, { id: "g", choices: [choice], usage: { prompt_tokens: 1, completion_tokens: 1 } })));
      expect((await openrouterAdapter.complete(OR_REQ, "k")).text).toBe("ok");
    }
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
