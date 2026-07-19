import { describe, it, expect, beforeEach } from "vitest";
import { buildPrompt, clearPromptCache, PromptError } from "@/lib/prompts/build-prompt";
import { safeParseJson, parseWithSchema, JsonParseError, restoreCjkQuotes } from "@/lib/prompts/parse";
import { VoiceAnalyzeOutput, ScenesOutput } from "@/lib/prompts/schemas";

describe("buildPrompt", () => {
  beforeEach(() => clearPromptCache());

  it("renders a real catalog prompt and returns id + version", () => {
    const built = buildPrompt("build_scenes", { script_text: "阿May推門而入。" });
    expect(built.promptId).toBe("build_scenes");
    expect(built.version).toBe("1");
    expect(built.text).toContain("阿May推門而入。");
    // constraint phrases survive rendering
    expect(built.text).toContain("錨點不得改寫");
    expect(built.text).toContain("20 個內容元素");
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
    const built = buildPrompt("rewrite_script", { novel_text: "N", style_note: "S" });
    expect(built.text).toContain("角色（VO）：");
    expect(built.text).toContain("角色（OS）：");
    expect(built.text).toContain("VO、OS 是保留字");
    expect(built.text).toContain("展示不明說");
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

  it("parses a valid build_scenes output", () => {
    const raw = '{"scenes": [{"index": 1, "startAnchor": "阿May推門", "endAnchor": "推到面前", "summary": "重逢"}]}';
    const out = parseWithSchema(raw, ScenesOutput);
    expect(out.scenes).toHaveLength(1);
    expect(out.scenes[0].startAnchor).toBe("阿May推門");
  });
});
