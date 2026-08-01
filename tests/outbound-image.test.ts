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
