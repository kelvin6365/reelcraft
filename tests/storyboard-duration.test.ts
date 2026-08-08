// 對白字數 → 鏡頭時長估算：冇對白照舊 3s，有對白 400ms/字 + 800ms clamp 2-15s。
import { describe, expect, it } from "vitest";
import { estimateShotDurationMs, shotDurationFromAudio } from "@/lib/storyboard/duration";

describe("estimateShotDurationMs", () => {
  it("no dialogue → legacy 3000", () => {
    expect(estimateShotDurationMs(undefined)).toBe(3000);
    expect(estimateShotDurationMs("")).toBe(3000);
    expect(estimateShotDurationMs("   ")).toBe(3000);
  });

  it("short dialogue floors at 2000", () => {
    // 2 字 → 800 + 800 = 1600 → floor 2000
    expect(estimateShotDurationMs("好呀")).toBe(2000);
  });

  it("10 chars → 4800", () => {
    expect(estimateShotDurationMs("一二三四五六七八九十")).toBe(10 * 400 + 800);
  });

  it("long dialogue ceils at 15000", () => {
    expect(estimateShotDurationMs("字".repeat(60))).toBe(15_000);
  });

  it("trims surrounding whitespace before counting", () => {
    expect(estimateShotDurationMs("  五個字嘅句  ")).toBe(5 * 400 + 800);
  });
});

// 真音長驅動：TTS 出咗之後，鏡頭長度唔再靠估。呢個係「配音同畫面對唔上」
// 嘅治本一步 —— 以前係先估字數生片，再夾硬把音塞入一段長度唔啱嘅片。
describe("shotDurationFromAudio", () => {
  const line = (lineIndex: number, audioDurationMs: number, offsetMs: number | null = null) => ({
    id: `l${lineIndex}`,
    lineIndex,
    offsetMs,
    audioDurationMs,
  });

  it("冇音檔就照用估算值，唔會把鏡頭壓到最短", () => {
    expect(shotDurationFromAudio([], 9000)).toBe(9000);
  });

  it("順序排嘅對白：總音長 + 尾巴呼吸位", () => {
    expect(shotDurationFromAudio([line(1, 2000), line(2, 3000)], 3000)).toBe(2000 + 3000 + 700);
  });

  // 用戶喺成片時間軸拖過 chip 之後，最遲收工嗰句唔一定係 lineIndex 最大嗰句，
  // 所以要行返 placeLines 而唔係加埋所有音長。
  it("用戶釘死咗位置（offsetMs）就跟返實際結尾，唔係加總", () => {
    expect(shotDurationFromAudio([line(1, 1000), line(2, 2000, 6000)], 3000)).toBe(6000 + 2000 + 700);
  });

  it("音長超出 15s 上限要封頂（模型 durationsSec grid 嘅頂）", () => {
    expect(shotDurationFromAudio([line(1, 30_000)], 3000)).toBe(15_000);
  });

  it("極短音檔都至少 2s（i2v 生唔到 0.5 秒片）", () => {
    expect(shotDurationFromAudio([line(1, 300)], 3000)).toBe(2000);
  });
});
