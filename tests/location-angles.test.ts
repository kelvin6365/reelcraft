import { describe, it, expect } from "vitest";
import { buildAngleImagePrompt, buildAngleNegativePrompt, mergeAngleMediaId } from "@/lib/prompts/location-angles";

describe("mergeAngleMediaId (PR3 角度圖寫回)", () => {
  const angles = [
    { label: "正面", prompt: "front view", mediaId: null },
    { label: "側面", prompt: "side view", mediaId: "m-old" },
    { label: "後面", prompt: "back view", mediaId: null },
  ];

  it("writes mediaId into the targeted angle only", () => {
    const next = mergeAngleMediaId(angles, 0, "m-new");
    expect(next[0]).toEqual({ label: "正面", prompt: "front view", mediaId: "m-new" });
  });

  it("leaves every other angle untouched (label/prompt/mediaId)", () => {
    const next = mergeAngleMediaId(angles, 0, "m-new");
    expect(next[1]).toEqual(angles[1]);
    expect(next[2]).toEqual(angles[2]);
  });

  it("overwrites an existing mediaId on regenerate", () => {
    const next = mergeAngleMediaId(angles, 1, "m-regenerated");
    expect(next[1].mediaId).toBe("m-regenerated");
  });

  it("throws on a negative index", () => {
    expect(() => mergeAngleMediaId(angles, -1, "m-new")).toThrow(RangeError);
  });

  it("throws on an out-of-range index", () => {
    expect(() => mergeAngleMediaId(angles, angles.length, "m-new")).toThrow(RangeError);
  });

  it("does not mutate the input array", () => {
    const copy = angles.map((a) => ({ ...a }));
    mergeAngleMediaId(angles, 0, "m-new");
    expect(angles).toEqual(copy);
  });
});

describe("buildAngleImagePrompt", () => {
  // 圖生圖用緊已鎖定主圖做參考（generateImage 見到 referenceMediaIds 就自動轉用
  // provider 嘅 /edit 端點），所以呢個 builder 唔再重複成段環境描述——淨係一句
  // 編輯指令，畫風/光線/佈局由參考圖本身帶。

  it("carries the label into the prompt as the actual camera-direction instruction — the bug this test guards: label used to be silently dropped, leaving the model no clue which way to point the camera", () => {
    const prompt = buildAngleImagePrompt({ label: "巢穴入口望向光照区域", prompt: "" });
    expect(prompt).toContain("巢穴入口望向光照区域");
    expect(prompt).toContain("reposition the camera to");
  });

  it("still includes angle.prompt (the physical-detail delta) when present, alongside the label", () => {
    const prompt = buildAngleImagePrompt({ label: "牆邊望向入口", prompt: "牆上掛住一幅畫" });
    expect(prompt).toContain("牆邊望向入口");
    expect(prompt).toContain("牆上掛住一幅畫");
  });

  it("omits blank segments cleanly and falls back to a generic viewpoint when label is empty", () => {
    const prompt = buildAngleImagePrompt({ label: "", prompt: "" });
    expect(prompt).toContain("a different viewpoint");
    expect(prompt).toContain("keep the same architecture, furniture, materials and lighting logic");
  });

  it("always includes the no-people guard regardless of label/prompt content", () => {
    const prompt = buildAngleImagePrompt({ label: "窗邊", prompt: "" });
    expect(prompt).toContain("no people, no characters, no text, no labels");
  });
});

describe("buildAngleNegativePrompt", () => {
  it("always excludes people even with no style negative prompt", () => {
    expect(buildAngleNegativePrompt({})).toContain("person");
  });

  it("merges the style's negative prompt with the people exclusion", () => {
    const negative = buildAngleNegativePrompt({ negativePrompt: "blurry, low quality" });
    expect(negative).toContain("blurry, low quality");
    expect(negative).toContain("silhouette of a person");
  });
});
