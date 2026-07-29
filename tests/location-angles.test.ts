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
  it("keeps the base env description (mood/lighting the reference image may not carry) but drops the style prefix (reference image already shows the art style)", () => {
    const prompt = buildAngleImagePrompt("a cozy tea house, warm evening light", { label: "entrance looking toward the counter", prompt: "" });
    expect(prompt).toContain("a cozy tea house, warm evening light");
    expect(prompt).toContain("same location as the reference image");
  });

  it("carries the label into the prompt as the actual camera-direction instruction — the bug this test guards: label used to be silently dropped, leaving the model no clue which way to point the camera", () => {
    const prompt = buildAngleImagePrompt("base", { label: "巢穴入口望向光照区域", prompt: "" });
    expect(prompt).toContain("巢穴入口望向光照区域");
    expect(prompt).toContain("camera repositioned to this new viewpoint");
  });

  it("still includes angle.prompt (the physical-detail delta) when present, alongside the label", () => {
    const prompt = buildAngleImagePrompt("base", { label: "牆邊望向入口", prompt: "牆上掛住一幅畫" });
    expect(prompt).toContain("牆邊望向入口");
    expect(prompt).toContain("牆上掛住一幅畫");
  });

  it("omits blank segments cleanly", () => {
    const prompt = buildAngleImagePrompt("base", { label: "", prompt: "" });
    expect(prompt.startsWith("base")).toBe(true);
  });

  it("starts with the consistency note when basePrompt, label and angle.prompt are all empty", () => {
    const prompt = buildAngleImagePrompt("", { label: "", prompt: "" });
    expect(prompt.startsWith("same location as the reference image")).toBe(true);
    expect(prompt).toContain("viewed from a different camera position");
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
