import { describe, it, expect, beforeEach } from "vitest";
import { buildPrompt, clearPromptCache, PromptError } from "@/lib/prompts/build-prompt";
import { safeParseJson, parseWithSchema, JsonParseError, restoreCjkQuotes } from "@/lib/prompts/parse";
import {
  VoiceAnalyzeOutput,
  ScenesOutput,
  ScriptReviewOutput,
  ExtractAssetsOutput,
  PhotographyOutput,
  ActingOutput,
  DetailOutput,
  ImagePromptShotOutput,
} from "@/lib/prompts/schemas";

describe("buildPrompt", () => {
  beforeEach(() => clearPromptCache());

  it("renders a real catalog prompt and returns id + version", () => {
    const built = buildPrompt("build_scenes", { script_text: "阿May推門而入。" });
    expect(built.promptId).toBe("build_scenes");
    expect(built.version).toBe("2");
    expect(built.text).toContain("阿May推門而入。");
    // constraint phrases survive rendering
    expect(built.text).toContain("錨點不得改寫");
    expect(built.text).toContain("20 個內容元素");
    // 閃回／時空跳躍必須切場 —— Scene.location 逐場綁定，一場跨兩個時空就一定用錯背景
    expect(built.text).toContain("時間／地點跳躍必須切場");
    expect(built.text).toContain("一個場景只能有一個時空");
    // no leftover placeholders
    expect(built.text).not.toMatch(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/);
  });

  it("renders a multi-variable prompt", () => {
    const built = buildPrompt("voice_analyze", {
      scene_text: "SCENE",
      shot_list_json: "[]",
    });
    expect(built.text).toContain("SCENE");
    expect(built.text).toContain("硬性上限 0.5");
    // VO/OS + parenthetical cue extraction rules (S1)
    expect(built.text).toContain("lineType");
    expect(built.text).toContain("dialogue／vo／os");
    expect(built.text).toContain("cue");
  });

  it("rewrite_script keeps the VO/OS parenthesis contract", () => {
    const built = buildPrompt("rewrite_script", { novel_text: "N", style_note: "S", theme: "T", character_bios: "B" });
    expect(built.text).toContain("角色（VO）：");
    expect(built.text).toContain("角色（OS）：");
    expect(built.text).toContain("VO、OS 是保留字");
    expect(built.text).toContain("展示不明說");
  });

  it("renders extract_assets v15 with the angles judgment criteria intact", () => {
    const built = buildPrompt("extract_assets", { script_text: "阿May推門而入。", raw_text: "" });
    expect(built.version).toBe("15");
    expect(built.text).toContain("重要場景必須輸出至少 2 個 angles；普通場景 angles 一律輸出空陣列");
  });

  it("renders extract_assets with the character-as-spatial-anchor ban intact — real-browser QA caught 王楚所在位置望向其他队员 leaking a character name straight into the image-gen prompt via label. Kept deliberately minimal (extends the existing enumerated list + existing reverse-example sentence) after a heavier first draft reproducibly destabilized gemini-2.5-flash-lite into malformed JSON on this exact 6-character script — verified via real A/B: v12 baseline succeeded twice, the heavier draft failed twice, this minimal version succeeded", () => {
    const built = buildPrompt("extract_assets", { script_text: "阿May推門而入。", raw_text: "" });
    expect(built.text).toContain("用角色個人或者隊伍做參照點都算");
    expect(built.text).toContain("王楚所在位置望向其他队员");
  });

  it("renders extract_assets with the angle-is-spatial-only-no-plot-events instruction intact", () => {
    const built = buildPrompt("extract_assets", { script_text: "阿May推門而入。", raw_text: "" });
    expect(built.text).toContain("唔可以用場口事件或劇情動作命名");
    expect(built.text).toContain("亦唔可以出現任何指涉人物嘅字眼");
    expect(built.text).toContain("prompt 預設留空");
    expect(built.text).toContain("圖生圖");
    expect(built.text).toContain("反面例子");
    expect(built.text).toContain("填 reason");
  });

  it("renders extract_assets with the label-feeds-directly-into-generateImage warning and dedicated label self-check intact — real-browser QA caught 眾人 leaking through reposition the camera to: {label}", () => {
    const built = buildPrompt("extract_assets", { script_text: "阿May推門而入。", raw_text: "" });
    expect(built.text).toContain("reposition the camera to");
    expect(built.text).toContain("眾人所在區域");
    expect(built.text).toContain("label 同 prompt 各自逐個檢查一次");
  });

  it("renders extract_assets with the location description no-people instruction intact — description feeds directly into every image gen call as basePrompt", () => {
    const built = buildPrompt("extract_assets", { script_text: "阿May推門而入。", raw_text: "" });
    expect(built.text).toContain("場景 description 判斷準則");
    expect(built.text).toContain("呢個欄位會直接原封不動傳落去生圖做主圖嘅 base prompt");
    expect(built.text).toContain("陈琳娜站在窗边，后有敲门声");
  });

  it("renders extract_assets with raw_text priority-of-source instructions intact", () => {
    const built = buildPrompt("extract_assets", { script_text: "阿May推門而入。", raw_text: "阿May：女，黑髮黑瞳。" });
    expect(built.text).toContain("客觀事實類資訊");
    expect(built.text).toContain("一律以 raw_text 入面嘅人物設定段落為準");
    expect(built.text).toContain("阿May：女，黑髮黑瞳。");
  });

  it("renders extract_assets with the gender-first appearance instruction intact", () => {
    const built = buildPrompt("extract_assets", { script_text: "阿May推門而入。", raw_text: "" });
    expect(built.text).toContain("性別、年齡、髮色");
    expect(built.text).toContain("外貌描述必須以性別開頭");
  });

  // 實測：機械音鏡頭出咗成塊英文 HUD（"...CLEARED EARTH DRAGON LAIR IN 23 MINUTES..."）
  // 連計時器，而本片係中文短劇。根因係 plan 容許 subject 淨寫「機械音提示」，
  // 落到生圖 prompt 就變成「a mechanical voice announces: ...」，模型當然照畫。
  it("renders storyboard_plan v5 with the no-invisible-subject rule intact", () => {
    const built = buildPrompt("storyboard_plan", { scene_text: "頭頂傳來機械音：通關成功。" });
    expect(built.version).toBe("5");
    expect(built.text).toContain("嚴禁產生冇可見畫面主體嘅鏡頭");
    expect(built.text).toContain("表面只有發光紋路同幾何邊框，冇任何文字");
    expect(built.text).toContain("嚴禁把「机械音」「旁白」「畫外音」「系統」「AI」呢類非人物寫入 characters");
  });

  it("renders storyboard_plan with the ≤2 same-frame character cap and its rationale intact", () => {
    const built = buildPrompt("storyboard_plan", { scene_text: "四人並肩衝出洞口。" });
    expect(built.text).toContain("每鏡 characters 硬性 ≤2");
    expect(built.text).toContain("最多 2 個");
    // 理由要留喺 prompt 入面，唔係淨落指令
    expect(built.text).toContain("只送到 2 張角色參考圖");
    expect(built.text).toContain("過肩鏡");
    // 遠景群像係放寬出口：人多寫入 subject，characters 照樣 ≤2
    expect(built.text).toContain("characters 照樣留 ≤2 個主角");
    // 軟措辭擋唔住（實測違反率 13.5%），要明講係硬上限 + 畀拆法
    expect(built.text).toContain("呢個係硬上限，唔係建議");
    expect(built.text).toContain("寧願多切一個鏡，都唔好塞多個人入去");
  });

  // 實測：subject 寫「夏雨戰隊在副本中勝利」而 characters 只有「王楚」，出圖就憑空多咗
  // 三個雜兵 —— 冇入 characters 就冇參考圖，但 prompt 自己描述咗佢哋，生圖層嗰句
  // 「不得加入未描述嘅角色」完全擋唔到。所以要喺分鏡層封閉人名。
  it("renders storyboard_plan with the subject/characters closure rule intact", () => {
    const built = buildPrompt("storyboard_plan", { scene_text: "王楚在後方支援，夏雨戰隊衝入副本。" });
    expect(built.text).toContain("都必須同時列入本鏡 characters");
    expect(built.text).toContain("就唔准喺 subject 提佢哋");
    // 集體稱謂唔可以當背景蒙混過關
    expect(built.text).toContain("群體稱謂當人算");
    expect(built.text).toContain("夏雨戰隊");
  });

  it("renders image_prompt_shot v10 with the sound-shot carrier rule and text-free surface ban intact", () => {
    const built = buildPrompt("image_prompt_shot", {
      shot_json: "{}",
      scene_blocking: "B",
      reference_legend: "L",
      locked_assets: "A",
      style_suffix: "S",
    });
    expect(built.version).toBe("10");
    expect(built.text).toContain("聲音本身冇畫面，唔可以直譯");
    expect(built.text).toContain("必須改為描述承載畫面");
    expect(built.text).toContain("必須明確寫成無文字無數字無符號");
    // 同 dialogue 禁令唔同：呢條擋嘅係模型「幫你畫返個正常運作嘅系統」
    expect(built.text).toContain("一個真實 HUD 本來就有字");
    expect(built.text).toContain("唔准當人畫");
    // 原有嘅 dialogue 禁令唔可以被取代
    expect(built.text).toContain("嚴禁");
    expect(built.text).toContain("Never render any text");
  });

  it("throws PROMPT_NOT_FOUND for an unknown promptId", () => {
    expect(() => buildPrompt("does_not_exist", {})).toThrowError(PromptError);
    try {
      buildPrompt("does_not_exist", {});
    } catch (e) {
      expect((e as PromptError).code).toBe("PROMPT_NOT_FOUND");
    }
  });

  it("throws VARIABLE_MISMATCH when a required variable is missing", () => {
    try {
      buildPrompt("build_scenes", {} as Record<string, string>);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(PromptError);
      expect((e as PromptError).code).toBe("VARIABLE_MISMATCH");
    }
  });

  it("throws VARIABLE_MISMATCH when an unexpected variable is provided", () => {
    try {
      buildPrompt("build_scenes", { script_text: "x", bogus: "y" });
      throw new Error("expected throw");
    } catch (e) {
      expect((e as PromptError).code).toBe("VARIABLE_MISMATCH");
    }
  });
});

describe("safeParseJson", () => {
  it("parses plain JSON", () => {
    expect(safeParseJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it("strips a ```json fence", () => {
    const raw = "```json\n{\"a\": 2}\n```";
    expect(safeParseJson(raw)).toEqual({ a: 2 });
  });

  it("strips a bare ``` fence", () => {
    expect(safeParseJson("```\n[1, 2, 3]\n```")).toEqual([1, 2, 3]);
  });

  it("drops prose around the JSON body", () => {
    const raw = '好的，結果如下：{"ok": true} 以上。';
    expect(safeParseJson(raw)).toEqual({ ok: true });
  });

  it("keeps 「」 corner brackets intact inside string values", () => {
    const parsed = safeParseJson('{"text": "他說「不」"}') as { text: string };
    expect(parsed.text).toBe("他說「不」");
    expect(restoreCjkQuotes(parsed.text)).toBe('他說"不"');
  });

  it("throws JsonParseError on invalid JSON", () => {
    expect(() => safeParseJson("not json at all")).toThrowError(JsonParseError);
  });

  it("repairs raw newlines/tabs inside string values (Unterminated string class)", () => {
    const broken = '{"blocking": {"cameraAxis": "鏡頭一律在窗一側，\n不越軸"}, "note": "a\tb"}';
    const out = safeParseJson(broken) as { blocking: { cameraAxis: string }; note: string };
    expect(out.blocking.cameraAxis).toBe("鏡頭一律在窗一側，\n不越軸");
    expect(out.note).toBe("a\tb");
    // control chars OUTSIDE strings (formatting whitespace) stay untouched
    expect(safeParseJson('{\n  "a": 1\n}')).toEqual({ a: 1 });
  });
});

describe("schema parsing", () => {
  it("parses a valid voice_analyze output", () => {
    const raw = JSON.stringify({
      lines: [
        { index: 1, text: "你等很久了嗎？", speaker: "阿May", emotion: "平靜", emotionStrength: 0.3, matchedShotIndex: 1 },
      ],
    });
    const out = parseWithSchema(raw, VoiceAnalyzeOutput);
    expect(out.lines[0].emotionStrength).toBe(0.3);
    // missing lineType/cue default (backward-compatible with old outputs)
    expect(out.lines[0].lineType).toBe("dialogue");
    expect(out.lines[0].cue).toBe("");
  });

  it("parses a valid script_review output and rejects unknown flags", () => {
    const good = JSON.stringify({
      scenes: [{ index: 1, label: "第1場・咖啡店", risk: { level: "review", flags: ["weak_hook"], note: "結尾偏弱" } }],
      overall: { level: "review", flags: [], note: "整體穩" },
    });
    const out = parseWithSchema(good, ScriptReviewOutput);
    expect(out.scenes[0].risk.flags).toEqual(["weak_hook"]);
    expect(out.overall.note).toBe("整體穩");
    const badFlag = good.replace("weak_hook", "made_up_flag");
    expect(() => parseWithSchema(badFlag, ScriptReviewOutput)).toThrow();
    // overall note is mandatory (one-line verdict)
    const noNote = JSON.stringify({ scenes: [], overall: { level: "ok", flags: [], note: "" } });
    expect(() => parseWithSchema(noNote, ScriptReviewOutput)).toThrow();
  });

  it("parses vo/os lineType and rejects unknown ones", () => {
    const mk = (lineType: string) =>
      JSON.stringify({ lines: [{ index: 1, text: "x", speaker: "s", lineType, cue: "苦笑", emotion: "無奈", emotionStrength: 0.3, matchedShotIndex: 1 }] });
    expect(parseWithSchema(mk("vo"), VoiceAnalyzeOutput).lines[0].lineType).toBe("vo");
    expect(parseWithSchema(mk("os"), VoiceAnalyzeOutput).lines[0].cue).toBe("苦笑");
    expect(() => parseWithSchema(mk("narration"), VoiceAnalyzeOutput)).toThrow();
  });

  it("rejects emotionStrength above the 0.5 hard cap", () => {
    const raw = JSON.stringify({
      lines: [{ index: 1, text: "x", speaker: "s", emotion: "憤怒", emotionStrength: 0.9, matchedShotIndex: 0 }],
    });
    expect(() => parseWithSchema(raw, VoiceAnalyzeOutput)).toThrow();
  });

  it("parses extract_assets locations with angles — important scene ≥2, normal scene empty", () => {
    const raw = JSON.stringify({
      characters: [],
      locations: [
        {
          name: "咖啡店",
          timeOfDay: "夜",
          description: "臨街咖啡店，夜晚燈光溫暖",
          angles: [
            { label: "吧台望向窗邊卡座", prompt: "吧台望出去，窗邊卡座映住街燈，桌上留一杯未喝完的咖啡。" },
            { label: "門口望向吧台", prompt: "推門望入，吧台後排列酒瓶與咖啡機，燈光偏暖黃。" },
          ],
        },
        { name: "便利店", timeOfDay: "日", description: "普通便利店", angles: [] },
      ],
    });
    const out = parseWithSchema(raw, ExtractAssetsOutput);
    expect(out.locations[0].angles).toHaveLength(2);
    expect(out.locations[1].angles).toHaveLength(0);
  });

  it("defaults extract_assets angles to [] when the model omits the field (backward-compatible with v2 output)", () => {
    const raw = JSON.stringify({
      characters: [],
      locations: [{ name: "天台", timeOfDay: "夜", description: "天台" }],
    });
    const out = parseWithSchema(raw, ExtractAssetsOutput);
    expect(out.locations[0].angles).toEqual([]);
  });

  it("rejects an extract_assets angle with an empty label", () => {
    const badLabel = JSON.stringify({
      characters: [],
      locations: [{ name: "天台", timeOfDay: "夜", description: "天台", angles: [{ label: "", prompt: "細節描述" }] }],
    });
    expect(() => parseWithSchema(badLabel, ExtractAssetsOutput)).toThrow();
  });

  it("allows an extract_assets angle with an empty prompt/reason — img2img needs no redundant description", () => {
    const raw = JSON.stringify({
      characters: [],
      locations: [{ name: "天台", timeOfDay: "夜", description: "天台", angles: [{ label: "遠望", prompt: "", reason: "" }] }],
    });
    const out = parseWithSchema(raw, ExtractAssetsOutput);
    const angles = out.locations[0]?.angles ?? [];
    expect(angles[0]?.prompt).toBe("");
    expect(angles[0]?.reason).toBe("");
  });

  it("parses a valid build_scenes output", () => {
    const raw = '{"scenes": [{"index": 1, "startAnchor": "阿May推門", "endAnchor": "推到面前", "summary": "重逢"}]}';
    const out = parseWithSchema(raw, ScenesOutput);
    expect(out.scenes).toHaveLength(1);
    expect(out.scenes[0].startAnchor).toBe("阿May推門");
  });
});

// A truncated response that repairTruncatedJson closes can come back as an empty
// or short-tailed structure. These schemas are the layer that must reject it —
// previously `{"shots":[]}` validated and every shot got a null pass written.
describe("truncation guards in the per-shot schemas", () => {
  const photoShot = { index: 1, lighting: "窗光", dof: "shallow", tone: "冷" };
  const actingShot = { index: 1, expression: "冷笑", bodyAction: "轉身" };
  const detailShot = { index: 1, shotSize: "中景", angle: "平視", camera: "固定" };

  it("rejects an empty shots array on photography / acting / detail", () => {
    expect(PhotographyOutput.safeParse({ shots: [] }).success).toBe(false);
    expect(ActingOutput.safeParse({ shots: [] }).success).toBe(false);
    expect(DetailOutput.safeParse({ shots: [] }).success).toBe(false);
  });

  it("still accepts a one-shot output on all three", () => {
    expect(PhotographyOutput.safeParse({ shots: [photoShot] }).success).toBe(true);
    expect(ActingOutput.safeParse({ shots: [actingShot] }).success).toBe(true);
    expect(DetailOutput.safeParse({ shots: [detailShot] }).success).toBe(true);
  });

  it("rejects an image prompt too short to still carry its mandated tail", () => {
    // 491 chars was the longest real truncated prompt observed in production.
    expect(ImagePromptShotOutput.safeParse({ prompt: "a".repeat(491) }).success).toBe(false);
  });

  it("accepts a full-length image prompt", () => {
    // 790 chars was the shortest complete prompt in the same episode.
    const out = ImagePromptShotOutput.parse({ prompt: "a".repeat(790) });
    expect(out.prompt).toHaveLength(790);
    expect(out.referencedAssets).toEqual([]);
  });
});
