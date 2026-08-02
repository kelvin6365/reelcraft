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
    expect(built.version).toBe("3");
    expect(built.text).toContain("阿May推門而入。");
    // constraint phrases survive rendering
    expect(built.text).toContain("錨點不得改寫");
    expect(built.text).toContain("20 個內容元素");
    // 閃回／時空跳躍必須切場 —— Scene.location 逐場綁定，一場跨兩個時空就一定用錯背景
    expect(built.text).toContain("時間／地點跳躍必須切場");
    expect(built.text).toContain("一個場景只能有一個時空");
    // v3：上一版規則寫咗但模型唔跟（重跑後閃回照樣夾喺場景 1），所以補觸發信號清單
    // ＋「一句都要切」＋具體後果，唔再靠模型自己判斷值唔值得獨立成場
    expect(built.text).toContain("見到即切，不要自行判斷值不值得獨立成場");
    expect(built.text).toContain("一句都要切");
    expect(built.text).toContain("閃回會沿用外層場景的 location");
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
    // 【】標記嘅非人物聲源照樣要配音、要出字幕，只係唔可以當佢係一個真人角色
    expect(built.text).toContain("劇本用方括號標記非人物聲源");
    expect(built.text).toContain("lineType 一律填 vo");
  });

  it("rewrite_script keeps the VO/OS parenthesis contract", () => {
    const built = buildPrompt("rewrite_script", { novel_text: "N", style_note: "S", theme: "T", character_bios: "B" });
    expect(built.text).toContain("角色（VO）：");
    expect(built.text).toContain("角色（OS）：");
    expect(built.text).toContain("VO、OS 是保留字");
    expect(built.text).toContain("展示不明說");
  });

  // 雷嘅根源：「机械音：…」同「王楚：…」格式一模一樣，下游分鏡分唔到邊個係人，
  // 把「机械音」寫入 characters 之後就去搵一張唔存在嘅參考圖，出圖憑空捏造一個人。
  // 兩種講者一定要喺劇本層結構上分開。
  it("rewrite_script marks non-human sound sources with brackets, separately from character dialogue", () => {
    const built = buildPrompt("rewrite_script", { novel_text: "N", style_note: "S", theme: "T", character_bios: "B" });
    expect(built.text).toContain("非人物聲源必須用方括號標記");
    expect(built.text).toContain("【聲源】：內容");
    expect(built.text).toContain("絕對不可以填真人角色名");
    // 真人即使唔喺畫面都用返 VO/OS —— 佢有肉身、有參考圖，係要畫出嚟嘅人
    expect(built.text).toContain("真人即使不在畫面內，仍然用「角色（VO）：」或「角色（OS）：」");
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
  it("renders storyboard_plan v7 with the no-invisible-subject rule intact", () => {
    const built = buildPrompt("storyboard_plan", { scene_text: "【機械音】：通關成功。" });
    expect(built.version).toBe("7");
    expect(built.text).toContain("嚴禁產生冇可見畫面主體嘅鏡頭");
    expect(built.text).toContain("表面只有發光紋路同幾何邊框，冇任何文字");
    expect(built.text).toContain("嚴禁把「机械音」「旁白」「畫外音」「系統」「AI」呢類非人物寫入 characters");
    // 根源修喺劇本層：非人物聲源用【】標記，同人物對白「角色：」結構上分開。
    // 分鏡要識讀呢個標記，唔可以再靠自己判斷邊個係人。
    expect(built.text).toContain("劇本用方括號標記非人物聲源");
    expect(built.text).toContain("唔准寫入 blocking.positions");
  });

  // 空間契約會逐鏡送落生圖並要求硬性遵守 —— 一鏡嘅動作凍結入契約，之後每一鏡都會照畫
  // （實測「劍=高舉，劍尖聖光沖天，巨龍倒塌」出現喺成場每一鏡）。
  it("renders storyboard_plan with the scene-wide-only blocking contract rules intact", () => {
    const built = buildPrompt("storyboard_plan", { scene_text: "鄭夏雨高舉長劍，巨龍倒下。" });
    expect(built.text).toContain("keyProps 只准寫全場恆定的狀態，嚴禁把某一鏡的動作凍結入契約");
    expect(built.text).toContain("持有者必須同 positions 一致");
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

  // 實測鏡 16：subject 寫「王楚制作药水和附魔；夏雨战队在副本中胜利」——兩個時刻。
  // 單幀模型冇時間軸，唯有把兩個時刻並排畫，出咗個 2×2 格拼貼；連續性條款嗰句
  // not a character sheet, grid or collage 完全守唔住，因為 prompt 自己就要求咗兩件事。
  it("renders storyboard_plan with the one-frozen-moment rule and its priority over the 15-char heuristic", () => {
    const built = buildPrompt("storyboard_plan", { scene_text: "他花了兩年製藥、附魔、練級，終於登頂。" });
    expect(built.text).toContain("一鏡一凝固瞬間（拆鏡硬性規則）");
    expect(built.text).toContain("subject 嚴禁出現時序詞");
    // 理由要留喺 prompt 入面，唔係淨落指令
    expect(built.text).toContain("拼貼喺短劇入面係廢鏡");
    // 同「每 15 字一鏡」嘅張力要明確判勝負，唔可以留返畀模型自己權衡
    expect(built.text).toContain("同「每 15 字一鏡」衝突時，呢條贏");
    expect(built.text).toContain("鏡頭數冇上限，同框人數同一鏡入面嘅時刻數先有上限");
    // 下游 collapseMultiMomentShots 會確定性剝除，要話畀模型知寫咗會消失
    expect(built.text).toContain("時序詞之後嘅內容會被直接剝走");
  });

  it("renders image_prompt_shot v12 with the sound-shot carrier rule and text-free surface ban intact", () => {
    const built = buildPrompt("image_prompt_shot", {
      shot_json: "{}",
      scene_blocking: "B",
      reference_legend: "L",
      locked_assets: "A",
      style_suffix: "S",
      output_language: "英文",
    });
    expect(built.version).toBe("12");
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

  // 實測：「夏雨戰隊」冇對應資產 → 冇參考圖 → 模型作咗四個一模一樣嘅金髮騎士，
  // 而下一鏡又係另一批樣。冇得唔畫嘅話，起碼要畫成認唔出樣、唔需要身份一致性嘅群眾。
  it("renders image_prompt_shot with the unnamed-crowd rule intact", () => {
    const built = buildPrompt("image_prompt_shot", {
      shot_json: "{}",
      scene_blocking: "B",
      reference_legend: "L",
      locked_assets: "A",
      style_suffix: "S",
      output_language: "繁體中文",
    });
    expect(built.text).toContain("無名群眾（locked_assets 冇對應資產嘅集體名詞）");
    expect(built.text).toContain("唔准把佢哋畫成可辨認嘅面孔");
    // 寫咗人數，模型就會逐個畫清楚 —— 要不可數描述
    expect(built.text).toContain("唔准把集體名詞寫成一個明確人數");
    expect(built.text).toContain("群眾唔准搶主體");
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

  // 截斷偵測由「字數地板」改成「條款在唔在」。字數綁死語言：輸出語言跟原文之後，
  // 中文密度高約 1.75 倍，舊嘅 .min(600) 一次過打回 32/47 條正常中文 prompt。
  it("rejects an image prompt whose continuity clause was truncated away", () => {
    // 生產環境見過最長嘅截斷殘骸 491 字元——長短唔係重點，冇咗尾巴先係。
    expect(ImagePromptShotOutput.safeParse({ prompt: "a".repeat(491) }).success).toBe(false);
  });

  it("accepts an English prompt carrying its continuity clause", () => {
    const p = `${"a".repeat(400)} Never render any text, captions, subtitles or words in the frame.`;
    expect(ImagePromptShotOutput.parse({ prompt: p }).referencedAssets).toEqual([]);
  });

  // 呢條係迴歸鎖：中文 prompt 短過舊門檻但完整，唔可以再被打回頭。
  it("accepts a shorter Chinese prompt carrying its continuity clause", () => {
    const p = `${"郑".repeat(200)}畫面中絕不出現任何文字、字幕、標題或文句。`;
    const out = ImagePromptShotOutput.parse({ prompt: p });
    expect(out.prompt.length).toBeLessThan(600);
  });
});
