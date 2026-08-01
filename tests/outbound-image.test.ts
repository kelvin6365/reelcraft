import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://user:pw@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.STORAGE_ENDPOINT ??= "http://localhost:9000";
process.env.STORAGE_BUCKET ??= "test";
process.env.STORAGE_ACCESS_KEY ??= "test";
process.env.STORAGE_SECRET_KEY ??= "test";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.API_ENCRYPTION_KEY ??= "y".repeat(32);

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/storage", () => ({ getStorage: () => ({}) }));

type Mod = typeof import("@/lib/ai/outbound-image");
let mod: Mod;

beforeAll(async () => {
  mod = await import("@/lib/ai/outbound-image");
});

describe("parseAspectRatio", () => {
  it("parses the ratios the pipeline actually emits", () => {
    expect(mod.parseAspectRatio("9:16")).toBeCloseTo(0.5625);
    expect(mod.parseAspectRatio("16:9")).toBeCloseTo(1.7778, 4);
    expect(mod.parseAspectRatio("1:1")).toBe(1);
    expect(mod.parseAspectRatio(" 3 : 4 ")).toBeCloseTo(0.75);
    expect(mod.parseAspectRatio("16x9")).toBeCloseTo(1.7778, 4);
  });

  it("returns null instead of throwing on junk (caller falls back to fit:inside)", () => {
    for (const bad of [undefined, null, "", "auto", "16:", ":9", "0:16", "16:0", "-9:16", "9:16:9", "abc"]) {
      expect(mod.parseAspectRatio(bad), `${bad}`).toBeNull();
    }
  });
});

describe("cropBox", () => {
  it("hits the target ratio exactly for a 16:9 scene ref going into a 9:16 shot", () => {
    const box = mod.cropBox({ width: 1344, height: 768 }, 9 / 16, 1024);
    expect(box).toEqual({ width: 432, height: 768 });
    expect(box.width / box.height).toBeCloseTo(0.5625, 4);
  });

  it("caps the long edge at maxEdge", () => {
    const box = mod.cropBox({ width: 768, height: 1344 }, 9 / 16, 1024);
    expect(box).toEqual({ width: 576, height: 1024 });
  });

  it("never enlarges a source smaller than maxEdge", () => {
    const box = mod.cropBox({ width: 400, height: 300 }, 9 / 16, 1024);
    expect(box.width).toBeLessThanOrEqual(400);
    expect(box.height).toBeLessThanOrEqual(300);
  });

  it("crops the other way for a landscape target", () => {
    const box = mod.cropBox({ width: 768, height: 1344 }, 16 / 9, 1024);
    expect(box).toEqual({ width: 768, height: 432 });
  });
});

describe("planEncode — 最後一張必須符合目標比例", () => {
  const nineSixteen = 9 / 16;

  it("crops a last-position identity anchor whose ratio fights the target", () => {
    // 16:9 project：最後一張係原生 9:16 嘅近臉圖 → 比例正確性贏，照切。
    expect(
      mod.planEncode({ identityAnchor: true, isLast: true, targetRatio: 16 / 9, sourceRatio: nineSixteen }),
    ).toBe("identity-crop");
  });

  it("leaves a last-position identity anchor alone when the ratio already matches (今日 = no-op)", () => {
    // 角色資產原生 768×1344 = 0.5714，對 9:16 = 0.5625 差 1.6%，喺容差內。
    expect(
      mod.planEncode({ identityAnchor: true, isLast: true, targetRatio: nineSixteen, sourceRatio: 768 / 1344 }),
    ).toBe("identity");
    expect(
      mod.planEncode({ identityAnchor: true, isLast: true, targetRatio: nineSixteen, sourceRatio: nineSixteen }),
    ).toBe("identity");
  });

  it("never crops an identity anchor that is not last, even on a ratio mismatch", () => {
    expect(
      mod.planEncode({ identityAnchor: true, isLast: false, targetRatio: 16 / 9, sourceRatio: nineSixteen }),
    ).toBe("identity");
  });

  it("always crops ordinary references regardless of position", () => {
    for (const isLast of [true, false]) {
      expect(mod.planEncode({ identityAnchor: false, isLast, targetRatio: nineSixteen, sourceRatio: 16 / 9 })).toBe(
        "crop",
      );
    }
  });

  it("falls back to the ratio-preserving path when the target or source is unknown", () => {
    expect(mod.planEncode({ identityAnchor: false, isLast: true, targetRatio: null, sourceRatio: 1 })).toBe(
      "fit-inside",
    );
    expect(mod.planEncode({ identityAnchor: true, isLast: true, targetRatio: null, sourceRatio: 1 })).toBe("identity");
    expect(mod.planEncode({ identityAnchor: true, isLast: true, targetRatio: nineSixteen, sourceRatio: null })).toBe(
      "identity",
    );
  });
});

describe("encodeReferenceImage — 實際出圖尺寸", () => {
  const solid = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: "#456" } })
      .jpeg()
      .toBuffer();

  it("keeps a last-position anchor at full identity resolution when the ratio matches", async () => {
    const out = await mod.encodeReferenceImage(await solid(768, 1344), {
      targetRatio: 9 / 16,
      identityAnchor: true,
      isLast: true,
    });
    // 原圖細過 IDENTITY_MAX_EDGE，唔放大，亦冇被切。
    expect(await sharp(out).metadata()).toMatchObject({ width: 768, height: 1344 });
  });

  it("crops a last-position anchor to the target ratio but keeps the identity resolution path", async () => {
    const out = await mod.encodeReferenceImage(await solid(768, 1344), {
      targetRatio: 16 / 9,
      identityAnchor: true,
      isLast: true,
    });
    const meta = await sharp(out).metadata();
    expect(meta.width / meta.height).toBeCloseTo(16 / 9, 2);
    // 長邊仍然由 IDENTITY_MAX_EDGE(2048) 而唔係 MAX_EDGE(1024) 管——只讓步「唔 crop」。
    expect(meta.width).toBe(768);
  });

  it("downscales an ordinary reference to the 1024 path and hits the target ratio exactly", async () => {
    const out = await mod.encodeReferenceImage(await solid(1344, 768), {
      targetRatio: 9 / 16,
      identityAnchor: false,
      isLast: true,
    });
    expect(await sharp(out).metadata()).toMatchObject({ width: 432, height: 768 });
  });
});

describe("dedupeReferenceRefs", () => {
  it("keeps first-seen order and drops empties", () => {
    expect(mod.dedupeReferenceRefs(["a", null, "b", undefined, "a", ""])).toEqual([
      { mediaId: "a", identityAnchor: false },
      { mediaId: "b", identityAnchor: false },
    ]);
  });

  it("accepts bare ids and identity-anchor records side by side", () => {
    expect(mod.dedupeReferenceRefs([{ mediaId: "face", identityAnchor: true }, "scene"])).toEqual([
      { mediaId: "face", identityAnchor: true },
      { mediaId: "scene", identityAnchor: false },
    ]);
  });

  it("makes identityAnchor sticky across duplicates", () => {
    expect(mod.dedupeReferenceRefs(["face", { mediaId: "face", identityAnchor: true }])).toEqual([
      { mediaId: "face", identityAnchor: true },
    ]);
  });

  it("lets the caller's own cap (shot-assets MAX_SHOT_REFS = 3) through untouched", () => {
    // 呢層唔可以再截一刀——legend 按呼叫方嗰個陣列編號。
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(mod.dedupeReferenceRefs(["a", "b", "c"])).toHaveLength(3);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("shouts instead of silently slicing when the payload backstop is hit", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(mod.dedupeReferenceRefs(["a", "b", "c", "d", "e", "f", "g", "h"])).toHaveLength(6);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
