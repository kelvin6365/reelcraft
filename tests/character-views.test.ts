import { describe, it, expect } from "vitest";
import {
  buildCharacterMainPrompt,
  buildCharacterViewPrompt,
  buildCharacterNegativePrompt,
  DEFAULT_CHARACTER_VIEWS,
  CHARACTER_FRONT_FRAMING,
} from "@/lib/prompts/character-views";

describe("buildCharacterMainPrompt — single front-view (was: turnaround sheet)", () => {
  it("includes the base prompt and the single-front-view framing", () => {
    const prompt = buildCharacterMainPrompt("a young woman with shoulder-length black hair", {});
    expect(prompt).toContain("a young woman with shoulder-length black hair");
    expect(prompt).toContain(CHARACTER_FRONT_FRAMING);
    expect(prompt).toContain("full-body standing front view");
  });

  it("falls back through assetPrefix -> prefix for style", () => {
    expect(buildCharacterMainPrompt("base", { assetPrefix: "asset style" })).toContain("asset style");
    expect(buildCharacterMainPrompt("base", { prefix: "generic style" })).toContain("generic style");
  });

  it("appends extra sentences (e.g. 墊臉 refFacePrompt/refFaceNote) after the framing", () => {
    const prompt = buildCharacterMainPrompt("base", {}, ["face must match the reference", "extra note"]);
    expect(prompt).toContain("face must match the reference");
    expect(prompt).toContain("extra note");
    expect(prompt.indexOf(CHARACTER_FRONT_FRAMING)).toBeLessThan(prompt.indexOf("face must match the reference"));
  });
});

describe("buildCharacterViewPrompt — identity-lock sandwich (mirrors prop-views)", () => {
  it("wraps the base prompt with an identity-lock open and close", () => {
    const prompt = buildCharacterViewPrompt("base appearance", { label: "側面", prompt: "" }, {});
    expect(prompt.startsWith("CRITICAL: this MUST be the exact same character")).toBe(true);
    expect(prompt).toContain("pixel-faithful to the reference image");
    expect(prompt.indexOf("CRITICAL")).toBeLessThan(prompt.indexOf("base appearance"));
  });

  it("applies VIEW_ANGLE_HINTS for 側面/背面", () => {
    const side = buildCharacterViewPrompt("base", { label: "側面", prompt: "" }, {});
    const back = buildCharacterViewPrompt("base", { label: "背面", prompt: "" }, {});
    expect(side).toContain("side profile view");
    expect(back).toContain("back view");
    expect(side).not.toContain("back view");
  });

  it("falls back to the raw label when it's not a known hint", () => {
    const prompt = buildCharacterViewPrompt("base", { label: "俯視特寫", prompt: "" }, {});
    expect(prompt).toContain("俯視特寫");
  });

  it("appends view.prompt as an optional extra when present", () => {
    const prompt = buildCharacterViewPrompt("base", { label: "側面", prompt: "holding a folded umbrella" }, {});
    expect(prompt).toContain("holding a folded umbrella");
  });

  it("keeps a pure white background even for per-view generation", () => {
    const prompt = buildCharacterViewPrompt("base", { label: "背面", prompt: "" }, {});
    expect(prompt).toContain("clean pure white background");
  });
});

describe("buildCharacterNegativePrompt", () => {
  it("merges the style's negative prompt with the built-in exclusions", () => {
    const negative = buildCharacterNegativePrompt({ negativePrompt: "blurry, low quality" });
    expect(negative).toContain("blurry, low quality");
    expect(negative).toContain("different character");
  });

  it("works with no style negative prompt", () => {
    const negative = buildCharacterNegativePrompt({});
    expect(negative).toContain("redesigned character");
  });
});

describe("DEFAULT_CHARACTER_VIEWS", () => {
  it("seeds exactly 側面 and 背面 with null mediaId and empty prompt", () => {
    expect(DEFAULT_CHARACTER_VIEWS).toEqual([
      { label: "側面", prompt: "", mediaId: null },
      { label: "背面", prompt: "", mediaId: null },
    ]);
  });
});
