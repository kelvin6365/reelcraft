import { describe, it, expect } from "vitest";
import { mergeNegatives } from "@/lib/prompts/negatives";

describe("mergeNegatives", () => {
  it("merges the LLM negative, style negative, and banned words (no source dropped)", () => {
    const out = mergeNegatives(
      "blurry, low quality",
      "plastic skin, extra fingers",
      ["film grain", "noise"],
    );
    expect(out).toBe("blurry, low quality, plastic skin, extra fingers, film grain, noise");
  });

  it("does NOT let the LLM negative replace the style negative (regression: was `||`)", () => {
    const out = mergeNegatives("blurry", "plastic skin", ["film grain"]);
    expect(out).toContain("plastic skin");
    expect(out).toContain("film grain");
  });

  it("still applies style negatives + banned words when the LLM returns none", () => {
    const out = mergeNegatives("", "plastic skin, oversaturated", ["film grain"]);
    expect(out).toBe("plastic skin, oversaturated, film grain");
  });

  it("de-dupes case-insensitively, keeping first-seen casing", () => {
    const out = mergeNegatives("Blurry, plastic skin", "blurry", ["Plastic Skin"]);
    expect(out).toBe("Blurry, plastic skin");
  });

  it("drops blanks and trims whitespace", () => {
    const out = mergeNegatives("  blurry ,, ", undefined, ["  noise  ", ""]);
    expect(out).toBe("blurry, noise");
  });

  it("returns an empty string when every source is empty", () => {
    expect(mergeNegatives("", undefined, [])).toBe("");
  });
});
