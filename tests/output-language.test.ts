import { describe, it, expect } from "vitest";
import { buildPrompt, clearPromptCache } from "@/lib/prompts/build-prompt";
import { detectTextLanguage, resolveOutputLanguage, OUTPUT_LANGUAGE_LABEL } from "@/lib/prompts/output-language";

describe("detectTextLanguage", () => {
  it("reads a Chinese novel excerpt as zh", () => {
    expect(detectTextLanguage("夜色壓落嚟，林知夏推開咖啡店嘅玻璃門，抬頭望向牆上嗰塊光板。")).toBe("zh");
  });

  it("reads an English excerpt as en", () => {
    expect(detectTextLanguage("Night fell as Lin walked through the glass door of the coffee shop.")).toBe("en");
  });

  // 中文小說夾英文人名／術語係常態 —— 比例門檻鬆到呢種混雜照樣判中文。
  it("still reads zh when Chinese prose carries English names and terms", () => {
    const mixed = "Alice Chen 推開 SkyLab 嘅玻璃門，望住 HUD 上面嗰行提示，心諗今次真係遲到咗。";
    expect(detectTextLanguage(mixed)).toBe("zh");
  });

  // 反方向：英文劇本夾少量中文（地名、標題）唔應該翻盤成中文。
  it("still reads en when English prose carries a few Chinese characters", () => {
    const mixed =
      "Interior, a small coffee shop in 香港. Lin pushes the door open and looks up at the blank panel on the wall, breath held.";
    expect(detectTextLanguage(mixed)).toBe("en");
  });

  it("returns null when there is not enough signal", () => {
    expect(detectTextLanguage("")).toBeNull();
    expect(detectTextLanguage(null)).toBeNull();
    expect(detectTextLanguage("ok")).toBeNull();
  });
});

describe("resolveOutputLanguage", () => {
  it("prefers the first source with signal — rawText over scriptText", () => {
    expect(resolveOutputLanguage(["夜色壓落嚟，林知夏推開玻璃門走入咖啡店入面。", "A fully English script body"])).toBe("zh");
  });

  // 用戶直接由劇本開始，rawText 係空 default "" —— 要退到 scriptText 而唔係食 default。
  it("falls back to scriptText when rawText is empty", () => {
    expect(resolveOutputLanguage(["", "INT. COFFEE SHOP - NIGHT. Lin pushes the door open and looks up."])).toBe("en");
  });

  it("defaults to zh when nothing has signal", () => {
    expect(resolveOutputLanguage(["", null, undefined])).toBe("zh");
  });
});

describe("image_prompt_shot output language wiring", () => {
  it("renders the zh branch markers and both continuity clause versions", () => {
    clearPromptCache();
    const vars = {
      shot_json: "{}",
      scene_blocking: "B",
      reference_legend: "L",
      locked_assets: "A",
      style_suffix: "S",
      output_language: OUTPUT_LANGUAGE_LABEL.zh,
    };
    const built = buildPrompt("image_prompt_shot", vars);
    expect(built.text).toContain("輸出的 prompt 語言必須係 繁體中文");
    expect(built.text).toContain("本模板下面凡標住【繁體中文】嘅分支就係你要跟嗰條");
    // 中文輸出之下，凍結外貌文本係照抄，唔再存在翻譯層
    expect(built.text).toContain("原樣照抄，一個字都唔准改");
    // 連續性條款兩版都要留喺模板（模型按語言揀），語義一個都唔可以走漏
    expect(built.text).toContain("輸出為單一電影鏡頭畫面，不是設定表、不是分格、不是拼貼。");
    expect(built.text).toContain("參考圖僅作身份參照：只沿用臉部、髮型與服裝");
    expect(built.text).toContain("不得加入本 prompt 未描述的任何角色。");
    expect(built.text).toContain("畫面中絕不出現任何文字、字幕、標題或文句。");
    expect(built.text).toContain("Render as one single cinematic frame, not a character sheet, grid or collage.");
    expect(built.text).toContain("Never render any text, captions, subtitles or words in the frame.");
    // Image N / style_suffix / negativePrompt 三個例外唔跟輸出語言
    expect(built.text).toContain("參考圖編號 `Image N`");
    expect(built.text).toContain("中文輸出之下都唔准譯、唔准改寫");
    expect(built.text).toContain("negativePrompt 欄位（一律英文");
  });

  it("renders the en branch label", () => {
    clearPromptCache();
    const built = buildPrompt("image_prompt_shot", {
      shot_json: "{}",
      scene_blocking: "B",
      reference_legend: "L",
      locked_assets: "A",
      style_suffix: "S",
      output_language: OUTPUT_LANGUAGE_LABEL.en,
    });
    expect(built.text).toContain("輸出的 prompt 語言必須係 英文");
    expect(built.text).toContain("逐項照譯成英文，term-for-term");
  });
});
