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
  it("includes the style prefix, base prompt, angle prompt and consistency note", () => {
    const prompt = buildAngleImagePrompt("a cozy tea house", { prompt: "from the entrance looking in" }, { locationPrefix: "cinematic style" });
    expect(prompt).toContain("cinematic style");
    expect(prompt).toContain("a cozy tea house");
    expect(prompt).toContain("from the entrance looking in");
    expect(prompt).toContain("same location as the reference image");
  });

  it("falls back through locationPrefix -> assetPrefix -> prefix", () => {
    expect(buildAngleImagePrompt("base", { prompt: "" }, { assetPrefix: "asset style" })).toContain("asset style");
    expect(buildAngleImagePrompt("base", { prompt: "" }, { prefix: "generic style" })).toContain("generic style");
  });

  it("omits blank segments cleanly", () => {
    const prompt = buildAngleImagePrompt("base", { prompt: "" }, {});
    expect(prompt.startsWith("base")).toBe(true);
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
