// 配音表 + 音色綁定解析。呢度守住嘅唔變式：一句對白冇明確音色來源就唔准
// 生成 —— 靜默跌返 provider 預設聲會令成集所有角色（連旁白）同一把聲，而
// 呢個 bug 冇任何 error 或者 log，淨係聽落先知。
import { describe, expect, it } from "vitest";
import { buildVoiceCast } from "@/lib/voice/cast";
import { checkVoiceMode, parseSpeakerVoices, resolveVoiceBinding } from "@/lib/voice/binding";
import { getVoicePreset, listVoicePresets } from "@/lib/voice/presets";

const PRESET = listVoicePresets()[0].id;

const char = (id: string, over: Partial<{ voicePresetId: string | null; voiceRefId: string | null }> = {}) => ({
  id,
  name: id,
  voicePresetId: null,
  voiceRefId: null,
  voiceCastNote: "",
  ...over,
});

describe("buildVoiceCast", () => {
  it("按 speaker 收埋一齊，數埋句數，保持出場次序", () => {
    const rows = buildVoiceCast(
      [
        { speaker: "阿明", characterId: "c1" },
        { speaker: "旁白", characterId: null },
        { speaker: "阿明", characterId: "c1" },
      ],
      [char("c1", { voicePresetId: PRESET })],
      {},
    );
    expect(rows.map((r) => r.speaker)).toEqual(["阿明", "旁白"]);
    expect(rows[0].lineCount).toBe(2);
    expect(rows[0].assigned).toBe(true);
    expect(rows[1].assigned).toBe(false);
  });

  it("冇角色嘅聲源（旁白／機械音）跌落集級 speakerVoices", () => {
    const rows = buildVoiceCast(
      [{ speaker: "機械音", characterId: null }],
      [],
      { 機械音: { presetId: PRESET } },
    );
    expect(rows[0].characterId).toBeNull();
    expect(rows[0].presetId).toBe(PRESET);
    expect(rows[0].assigned).toBe(true);
  });

  // voice_analyze 逐行判斷 characterId，同一個名可能有啲行認得出有啲認唔出。
  // 角色綁定係跨集嘅，一定要贏過集級 fallback，唔係同一個人會有兩把聲。
  it("同名 speaker 有一行認到角色，就當佢係角色", () => {
    const rows = buildVoiceCast(
      [
        { speaker: "阿明", characterId: null },
        { speaker: "阿明", characterId: "c1" },
      ],
      [char("c1", { voicePresetId: PRESET })],
      { 阿明: { presetId: "male-qn-qingse" } },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].characterId).toBe("c1");
    expect(rows[0].presetId).toBe(PRESET);
  });

  it("speaker 空白當「未知」，唔會靜靜漏咗一把聲唔計", () => {
    const rows = buildVoiceCast([{ speaker: "", characterId: null }], [], {});
    expect(rows[0].speaker).toBe("未知");
    expect(rows[0].assigned).toBe(false);
  });
});

describe("resolveVoiceBinding", () => {
  const base = { speakerVoices: {}, refAudioById: new Map<string, string>() };

  it("未派音 = 唔准生成（唔係靜靜用預設聲）", () => {
    const r = resolveVoiceBinding({ ...base, speaker: "阿明", character: char("c1") });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unbound");
  });

  it("preset 綁定帶埋 vendor，畀模型能力閘對數", () => {
    const r = resolveVoiceBinding({ ...base, speaker: "阿明", character: char("c1", { voicePresetId: PRESET }) });
    expect(r).toEqual({ ok: true, binding: { kind: "preset", presetId: PRESET, vendor: getVoicePreset(PRESET)!.vendor } });
  });

  it("參考音綁定解成 MediaObject id", () => {
    const r = resolveVoiceBinding({
      ...base,
      speaker: "阿明",
      character: char("c1", { voiceRefId: "v1" }),
      refAudioById: new Map([["v1", "m1"]]),
    });
    expect(r).toEqual({ ok: true, binding: { kind: "ref", mediaId: "m1" } });
  });

  // 音色被刪／音色 id 打錯，都唔可以當「冇綁」靜靜跌返預設聲 —— 要講清楚
  // 邊個 speaker 邊個 id 出事，用戶先改得到。
  it("綁咗但搵唔返 → 明確報錯，唔當未綁", () => {
    const missingRef = resolveVoiceBinding({ ...base, speaker: "阿明", character: char("c1", { voiceRefId: "gone" }) });
    expect(missingRef.ok).toBe(false);
    if (!missingRef.ok) expect(missingRef.reason).toBe("missing-ref");

    const badPreset = resolveVoiceBinding({ ...base, speaker: "阿明", character: char("c1", { voicePresetId: "冇呢個" }) });
    expect(badPreset.ok).toBe(false);
    if (!badPreset.ok) expect(badPreset.reason).toBe("unknown-preset");
  });
});

describe("checkVoiceMode", () => {
  const preset = { kind: "preset" as const, presetId: PRESET, vendor: "minimax" };
  const ref = { kind: "ref" as const, mediaId: "m1" };

  it("index-tts-2 只食參考音 —— 揀咗內置音色要即刻話畀用戶知", () => {
    const r = checkVoiceMode(preset, { voiceModes: ["ref"] }, "fal::index-tts-2");
    expect(r.ok).toBe(false);
  });

  it("minimax 只食內置音色 —— 上傳嘅參考音配唔到", () => {
    const r = checkVoiceMode(ref, { voiceModes: ["preset"], voicePresetVendor: "minimax" }, "fal::minimax");
    expect(r.ok).toBe(false);
  });

  it("vendor 對唔上都要攔（音色 id 係人哋 API 常數，過唔到界）", () => {
    const r = checkVoiceMode(
      { kind: "preset", presetId: PRESET, vendor: "minimax" },
      { voiceModes: ["preset"], voicePresetVendor: "elevenlabs" },
      "x::y",
    );
    expect(r.ok).toBe(false);
  });

  it("未聲明能力嘅模型唔攔（照舊行為，最多 provider 自己回錯）", () => {
    expect(checkVoiceMode(preset, null, "x::y").ok).toBe(true);
  });
});

describe("parseSpeakerVoices", () => {
  it("壞資料當冇綁，唔炸鑊", () => {
    expect(parseSpeakerVoices({ 旁白: { wat: 1 } })).toEqual({});
    expect(parseSpeakerVoices(null)).toEqual({});
    expect(parseSpeakerVoices({ 旁白: { presetId: "x" } })).toEqual({ 旁白: { presetId: "x" } });
  });
});
