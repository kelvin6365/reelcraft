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
  // 歷史註腳：呢組數字（1344×768）原本嚟自「場景鎖定圖係 16:9」嗰個年代。場景資產
  // 而家原生跟 project.videoRatio 出圖，唔會再係橫圖，但 cropBox 本身係純幾何——
  // 任何橫圖進豎框（例如用戶自己上載嘅墊臉相）都行同一條數，所以呢個 case 照留。
  it("crops a landscape source down to a portrait target exactly (1344×768 → 9:16)", () => {
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
    // 16:9 專案：最後一張係原生 9:16 嘅近臉圖 → 比例正確性贏，照切。
    // （注意 project.videoRatio 而家亦決定場景資產比例，所以「目標 16:9」呢個情境
    // 係真實存在嘅——橫片專案成條 pipeline 都係 16:9。）
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

// 實測事故（2026-08-03）：角色近臉特寫同鎖定主圖完全唔同人——眼色、髮長、服裝全部變。
// 根因唔喺 prompt，喺參考圖：鎖定圖係 9:16 全身站姿（768×1344），近臉出圖係 1:1，
// center-crop 落去攞到嘅係 768×768 中段腰腹，完全冇頭冇臉，而 prompt 同時叫模型
// 「照抄參考圖嘅臉同髮型」。模型冇臉可抄唯有作一個。
describe("cropAnchor:head — 由全身圖生近臉唔可以 center-crop", () => {
  const FULL_BODY = { width: 768, height: 1344 }; // 角色鎖定圖實際尺寸
  const SQUARE = 1; // 1:1

  it("9:16 全身圖切 1:1 會攞到正方形中段（所以錨點好緊要）", () => {
    expect(mod.cropBox(FULL_BODY, SQUARE, 1024)).toEqual({ width: 768, height: 768 });
  });

  it("冇標 identityAnchor 就一定行 crop —— 近臉路徑舊版正正中招", () => {
    expect(mod.planEncode({ identityAnchor: false, isLast: true, targetRatio: SQUARE, sourceRatio: 768 / 1344 })).toBe("crop");
  });

  // 標咗 identityAnchor 都仲係會切（最後一張要夾出圖比例，見 planEncode 論證），
  // 所以單靠 identityAnchor 救唔到 —— 一定要同時指定由頂切。
  // 註：cropAnchor:"head" 喺 encodeReferenceImage 入面行喺 planEncode 之前，
  // 所以呢個 plan 對佢冇影響 —— 呢個 case 記錄嘅係「單靠 identityAnchor 救唔到」。
  it("identityAnchor + 最後一張 + 比例唔啱 → identity-crop，照樣切走塊頭", () => {
    expect(mod.planEncode({ identityAnchor: true, isLast: true, targetRatio: SQUARE, sourceRatio: 768 / 1344 })).toBe("identity-crop");
  });

  it("dedupe 保留 cropAnchor:head，唔會喺去重嗰陣跌咗", () => {
    const [ref] = mod.dedupeReferenceRefs([{ mediaId: "m1", identityAnchor: true, cropAnchor: "head" }]);
    expect(ref.cropAnchor).toBe("head");
  });

  it("同一張圖被要求過切頭肩框，就唔會被之後嘅預設值蓋返 centre", () => {
    const [ref] = mod.dedupeReferenceRefs([
      { mediaId: "m1", cropAnchor: "head" },
      { mediaId: "m1", identityAnchor: true },
    ]);
    expect(ref.cropAnchor).toBe("head");
    expect(ref.identityAnchor).toBe(true);
  });
});
