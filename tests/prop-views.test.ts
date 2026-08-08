import { describe, it, expect } from "vitest";
import {
  buildPropMainPrompt,
  buildPropViewPrompt,
  buildPropNegativePrompt,
  isPlaceholderValue,
  missingRequiredPropFields,
  PROP_REF_FRAMING,
} from "@/lib/prompts/prop-views";

describe("buildPropMainPrompt — 白底標準（Prop asset design）", () => {
  it("always includes the pure-white-background framing, no 'neutral' fallback", () => {
    const prompt = buildPropMainPrompt("a jade pendant", "jade", "5cm diameter", "key", {});
    expect(prompt).toContain("pure white background");
    expect(prompt).toContain(PROP_REF_FRAMING);
  });

  it("includes material and dimensions metadata", () => {
    const prompt = buildPropMainPrompt("a jade pendant", "jade", "5cm diameter", "key", {});
    expect(prompt).toContain("jade");
    expect(prompt).toContain("5cm diameter");
  });

  it("adds the effect-visibility note only for tier=effect", () => {
    const key = buildPropMainPrompt("a glowing orb", "", "", "key", {});
    const effect = buildPropMainPrompt("a glowing orb", "", "", "effect", {});
    expect(key).not.toContain("must remain vividly visible");
    expect(effect).toContain("must remain vividly visible");
  });

  it("falls back through assetPrefix -> prefix for style", () => {
    expect(buildPropMainPrompt("base", "", "", "key", { assetPrefix: "asset style" })).toContain("asset style");
    expect(buildPropMainPrompt("base", "", "", "key", { prefix: "generic style" })).toContain("generic style");
  });
});

describe("buildPropViewPrompt — identity-lock (實測驗證 view drift after separate edit calls)", () => {
  it("includes the base prompt, an optional user/AI-supplied view detail and a forceful identity-lock instruction, still white background", () => {
    const prompt = buildPropViewPrompt("a jade pendant", { label: "反面", prompt: "engraved pattern visible" }, "key", {});
    expect(prompt).toContain("a jade pendant");
    expect(prompt).toContain("engraved pattern visible");
    expect(prompt).toContain("pure white background");
  });

  it("derives the angle instruction from label alone when view.prompt is empty (真係有需要先打 — 唔打都要知係邊個角度)", () => {
    const front = buildPropViewPrompt("base", { label: "正面", prompt: "" }, "key", {});
    const back = buildPropViewPrompt("base", { label: "反面", prompt: "" }, "key", {});
    expect(front).toContain("front-facing view");
    expect(back).toContain("back view");
    expect(front).not.toContain("back view");
  });

  it("puts the identity-lock instruction at both the start and end (sandwich emphasis)", () => {
    const prompt = buildPropViewPrompt("base", { label: "正面", prompt: "" }, "key", {});
    expect(prompt.startsWith("CRITICAL: this MUST be the exact same physical object")).toBe(true);
    expect(prompt).toContain("pixel-faithful to the reference image");
  });

  it("forbids reinterpreting the object, not just describing consistency loosely", () => {
    const prompt = buildPropViewPrompt("base", { label: "正面", prompt: "" }, "key", {});
    expect(prompt).toContain("do not redesign, reinterpret, or invent a different object");
  });
});

describe("buildPropNegativePrompt", () => {
  it("always excludes scene/environment backgrounds and people, even with no style negative", () => {
    const negative = buildPropNegativePrompt({});
    expect(negative).toContain("scene background");
    expect(negative).toContain("people");
  });

  it("merges the style's negative prompt with the built-in exclusions", () => {
    const negative = buildPropNegativePrompt({ negativePrompt: "blurry, low quality" });
    expect(negative).toContain("blurry, low quality");
    expect(negative).toContain("environment");
  });

  it("explicitly excludes drifting into a different redesigned object (實測發現：反面生咗把完全唔同嘅劍)", () => {
    const negative = buildPropNegativePrompt({});
    expect(negative).toContain("different object");
    expect(negative).toContain("redesigned object");
  });
});

// 交付標準：要抽就要抽齊（用戶 2026-08-03）。實測 UI 出「材質：未知 ・ 尺寸：未知」，
// 而 buildPropMainPrompt 舊版 filter(Boolean) 只擋空字串，「未知」兩個字會原樣串入
// prompt 變成兩個叫模型自由發揮嘅空槽。
describe("isPlaceholderValue", () => {
  it("空白同佔位字眼都當冇填", () => {
    for (const v of ["", "   ", "未知", "不詳", "未提及", "N/A", "none", "-", "？"]) {
      expect(isPlaceholderValue(v), v).toBe(true);
    }
  });

  it("真實值唔會誤殺", () => {
    for (const v of ["羊脂白玉", "約 90 公分長", "聖銀", "藍白色能量流光"]) {
      expect(isPlaceholderValue(v), v).toBe(false);
    }
  });
});

describe("missingRequiredPropFields", () => {
  it("key/scene 要 material + dimensions", () => {
    expect(missingRequiredPropFields({ tier: "key", material: "聖銀", dimensions: "約 90 公分", physicalParams: "" })).toEqual([]);
    expect(missingRequiredPropFields({ tier: "scene", material: "未知", dimensions: "未知", physicalParams: "" })).toEqual([
      "material",
      "dimensions",
    ]);
  });

  // 光效冇實體尺寸，逼佢填 dimensions 只會逼模型作嘢；改為要求 physicalParams。
  it("effect 唔要 dimensions，改要 physicalParams", () => {
    expect(missingRequiredPropFields({ tier: "effect", material: "藍白色能量流光", dimensions: "", physicalParams: "亮度高、持續 2 秒" })).toEqual([]);
    expect(missingRequiredPropFields({ tier: "effect", material: "藍白色能量流光", dimensions: "", physicalParams: "" })).toEqual(["physicalParams"]);
  });
});

describe("buildPropMainPrompt metadata", () => {
  it("佔位字眼唔准入 prompt", () => {
    const out = buildPropMainPrompt("白色浴袍", "未知", "未知", "scene", {});
    expect(out).not.toContain("未知");
  });

  it("真實 metadata 照樣入 prompt", () => {
    const out = buildPropMainPrompt("聖銀長劍", "聖銀", "約 90 公分", "key", {});
    expect(out).toContain("聖銀");
    expect(out).toContain("約 90 公分");
  });
});
