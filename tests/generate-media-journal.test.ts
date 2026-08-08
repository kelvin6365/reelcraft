// generate-media 同 provider request journal 之間嘅接線。
//
// 點解要有呢隻測試：runJournaled 嘅 poll ops 係 `falPoll(h, apiKey, "image")`
// —— 個 apiType 係手寫 literal。三條路徑（image/video/tts）任何一條寫錯，
// URL_KEYS 就會去錯 result key，而呢個錯要插住真 key 生嘢先爆得出。guard
// （scripts/guards/provider-journal-check.mjs）只數得到 call site 數目，捉唔到
// 換錯 literal。同時鎖住「收貨之後一定 markConsumed」——冇埋單嘅話下次重試會
// 攞返舊 request。
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://user:pw@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.STORAGE_ENDPOINT ??= "http://localhost:9000";
process.env.STORAGE_BUCKET ??= "test";
process.env.STORAGE_ACCESS_KEY ??= "test";
process.env.STORAGE_SECRET_KEY ??= "test";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.API_ENCRYPTION_KEY ??= "y".repeat(32);

interface Row {
  id: string;
  taskId: string;
  stepKey: string;
  status: string;
  mediaId: string | null;
  endpoint: string;
  requestId: string;
  createdAt: Date;
}

const db = vi.hoisted(() => ({ rows: [] as Row[] }));

vi.mock("@/lib/db", () => ({
  prisma: {
    providerRequest: {
      findFirst: vi.fn(async () => null), // 每次測試都係第一次 submit
      create: vi.fn(async ({ data }: { data: Omit<Row, "mediaId" | "createdAt"> }) => {
        db.rows.push({ ...data, mediaId: null, createdAt: new Date() });
        return data;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const hit = db.rows.filter((r) => r.id === where.id);
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      }),
    },
    aiCallLog: { create: vi.fn(async () => ({})) },
  },
}));

vi.mock("@/lib/ai/provider-key", () => ({ getProviderKey: vi.fn(async () => "k") }));
vi.mock("@/lib/billing/budget", () => ({ assertWithinBudget: vi.fn(async () => {}) }));
vi.mock("@/lib/ai/capabilities", () => ({
  getCapabilities: vi.fn(() => ({ supportsReferenceImages: true })),
  getCapabilityEntry: vi.fn(() => null),
  priceMedia: vi.fn(() => null),
}));
vi.mock("@/lib/media/service", () => ({
  createMediaFromUrl: vi.fn(async ({ url }: { url: string }) => ({ id: `media-for-${url}` })),
  createMediaFromBuffer: vi.fn(async () => ({ id: "media-buf" })),
  getMediaUrl: vi.fn(async () => "https://cdn/ref.wav"),
}));

const fal = vi.hoisted(() => ({ polls: [] as { requestId: string; apiType: string }[], submits: [] as string[] }));
vi.mock("@/lib/ai/adapters/fal", () => ({
  falImageSubmit: vi.fn(async () => {
    fal.submits.push("image");
    return { endpoint: "fal-ai/m", requestId: "req-img" };
  }),
  falVideoSubmit: vi.fn(async () => {
    fal.submits.push("video");
    return { endpoint: "fal-ai/m", requestId: "req-vid" };
  }),
  falTtsSubmit: vi.fn(async () => {
    fal.submits.push("tts");
    return { endpoint: "fal-ai/m", requestId: "req-tts" };
  }),
  falPoll: vi.fn(async (h: { requestId: string }, _k: string, apiType: string) => {
    fal.polls.push({ requestId: h.requestId, apiType });
    return { result: {}, url: `https://cdn/${apiType}.out` };
  }),
  falCancel: vi.fn(async () => {}),
}));
vi.mock("@/lib/ai/adapters/atlascloud", () => ({
  atlasImageSubmit: vi.fn(async () => ({ endpoint: "generateImage", requestId: "pred-img" })),
  atlasVideoSubmit: vi.fn(async () => ({ endpoint: "generateVideo", requestId: "pred-vid" })),
  atlasTtsSubmit: vi.fn(async () => ({ endpoint: "generateSpeech", requestId: "pred-tts" })),
  atlasPoll: vi.fn(async () => ({ url: "https://cdn/atlas.out" })),
  atlasCancel: vi.fn(async () => {}),
}));

const { generateImage, generateVideo, generateTts } = await import("@/lib/ai/generate-media");

const CTX = { userId: "u1", taskId: "t1", projectId: "p1" };

beforeEach(() => {
  db.rows = [];
  fal.polls = [];
  fal.submits = [];
});

describe("generate-media × provider request journal", () => {
  it("generateImage：submit → 寫低 pending → 用 apiType 'image' poll → 收貨後 consumed", async () => {
    const media = await generateImage(CTX, {
      modelKey: "fal::fal-ai/m",
      prompt: "a cat",
      aspectRatio: "9:16",
      keyPrefix: "shots",
    });

    expect(fal.polls).toEqual([{ requestId: "req-img", apiType: "image" }]);
    expect(media.id).toBe("media-for-https://cdn/image.out");
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({
      taskId: "t1",
      status: "consumed",
      requestId: "req-img",
      mediaId: "media-for-https://cdn/image.out",
    });
  });

  it("generateVideo：apiType 係 'video'，唔係 image", async () => {
    await generateVideo(CTX, {
      modelKey: "fal::fal-ai/m",
      prompt: "a cat walks",
      durationSec: 5,
      aspectRatio: "9:16",
      keyPrefix: "shots",
    });

    expect(fal.polls).toEqual([{ requestId: "req-vid", apiType: "video" }]);
    expect(db.rows[0]).toMatchObject({ status: "consumed", requestId: "req-vid" });
  });

  it("generateTts：apiType 係 'tts'", async () => {
    await generateTts(CTX, { modelKey: "fal::fal-ai/m", text: "喂", keyPrefix: "voice" });

    expect(fal.polls).toEqual([{ requestId: "req-tts", apiType: "tts" }]);
    expect(db.rows[0]).toMatchObject({ status: "consumed", requestId: "req-tts" });
  });

  it("atlascloud 一樣行 journal（唔係只有 fal 有）", async () => {
    await generateImage(
      { ...CTX, taskId: "t2" },
      { modelKey: "atlascloud::nano-banana-2", prompt: "a cat", aspectRatio: "9:16", keyPrefix: "shots" },
    );

    expect(fal.polls).toHaveLength(0);
    expect(db.rows[0]).toMatchObject({ taskId: "t2", status: "consumed", requestId: "pred-img" });
  });

  it("三條路徑寫落 journal 嘅 apiType 各自唔同（換錯 literal 即刻捉到）", async () => {
    await generateImage(CTX, { modelKey: "fal::fal-ai/m", prompt: "x", aspectRatio: "9:16", keyPrefix: "k" });
    await generateVideo(CTX, {
      modelKey: "fal::fal-ai/m",
      prompt: "x",
      durationSec: 5,
      aspectRatio: "9:16",
      keyPrefix: "k",
    });
    await generateTts(CTX, { modelKey: "fal::fal-ai/m", text: "x", keyPrefix: "k" });

    expect(db.rows.map((r) => (r as unknown as { apiType: string }).apiType)).toEqual(["image", "video", "tts"]);
  });
});
