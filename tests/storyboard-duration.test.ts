// 對白字數 → 鏡頭時長估算：冇對白照舊 3s，有對白 400ms/字 + 800ms clamp 2-15s。
import { describe, expect, it } from "vitest";
import { estimateShotDurationMs } from "@/lib/storyboard/duration";

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
