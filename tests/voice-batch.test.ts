// 配音批量提交：邊啲行入隊、邊啲行剔走。剔錯 = 用戶撳極都唔配到某幾句；
// 唔剔 = 排一堆注定 VOICE_NOT_CAST／空台詞失敗嘅 task，仲要每句都嚇人一跳。
import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitTask, voiceLineFindMany, characterFindMany, voiceFindMany } = vi.hoisted(() => ({
  submitTask: vi.fn(async () => ({ taskId: "t1", deduped: false })),
  voiceLineFindMany: vi.fn(async () => [] as unknown[]),
  characterFindMany: vi.fn(async () => [] as unknown[]),
  voiceFindMany: vi.fn(async () => [] as unknown[]),
}));

vi.mock("@/lib/task/submit", () => ({ submitTask }));
vi.mock("@/lib/db", () => ({
  prisma: {
    voiceLine: { findMany: voiceLineFindMany },
    character: { findMany: characterFindMany },
    voice: { findMany: voiceFindMany },
  },
}));

import { parseLineIds, submitVoiceLineBatch } from "@/lib/api/voice-batch";
import { listVoicePresets } from "@/lib/voice/presets";

const PRESET = listVoicePresets()[0].id;
const EPISODE = { id: "e1", projectId: "p1", speakerVoices: {} as unknown };

beforeEach(() => {
  vi.clearAllMocks();
  characterFindMany.mockResolvedValue([]);
  voiceFindMany.mockResolvedValue([]);
});

describe("parseLineIds", () => {
  it("冇 lineIds → null（即係『補配所有未有音檔嘅行』）", () => {
    expect(parseLineIds(null)).toBeNull();
    expect(parseLineIds({})).toBeNull();
    expect(parseLineIds({ lineIds: "l1" })).toBeNull();
  });

  it("剔走非字串同空字串；全部無效當冇揀", () => {
    expect(parseLineIds({ lineIds: ["l1", "", 42, null, "l2"] })).toEqual(["l1", "l2"]);
    expect(parseLineIds({ lineIds: ["", null] })).toBeNull();
  });

  it("封頂 1000 —— 擋偽造 body 送巨型 IN 清單", () => {
    expect(parseLineIds({ lineIds: Array.from({ length: 1500 }, (_, i) => `l${i}`) })).toHaveLength(1000);
  });
});

describe("submitVoiceLineBatch", () => {
  it("空台詞唔入隊（配咗都係錯，仲要白畀錢）", async () => {
    characterFindMany.mockResolvedValue([{ id: "c1", voicePresetId: PRESET, voiceRefId: null }]);
    voiceLineFindMany.mockResolvedValue([
      { id: "l1", content: "有嘢講", speaker: "阿明", characterId: "c1" },
      { id: "l2", content: "   ", speaker: "阿明", characterId: "c1" },
    ]);

    const r = await submitVoiceLineBatch({ userId: "u1", episode: EPISODE, lineIds: ["l1", "l2"] });

    expect(r).toEqual({ submitted: 1, skippedEmpty: 1, skippedUncast: 0 });
    expect(submitTask).toHaveBeenCalledTimes(1);
    expect(submitTask).toHaveBeenCalledWith(expect.objectContaining({ targetId: "l1", type: "TTS_LINE" }));
  });

  it("未派音色嘅行唔入隊，並且照樣報數畀 UI 交代", async () => {
    characterFindMany.mockResolvedValue([
      { id: "c1", voicePresetId: PRESET, voiceRefId: null },
      { id: "c2", voicePresetId: null, voiceRefId: null },
    ]);
    voiceLineFindMany.mockResolvedValue([
      { id: "l1", content: "派咗音", speaker: "阿明", characterId: "c1" },
      { id: "l2", content: "未派音", speaker: "阿May", characterId: "c2" },
    ]);

    const r = await submitVoiceLineBatch({ userId: "u1", episode: EPISODE, lineIds: null });

    expect(r).toEqual({ submitted: 1, skippedEmpty: 0, skippedUncast: 1 });
    expect(submitTask).toHaveBeenCalledTimes(1);
  });

  it("冇角色嘅聲源（旁白）跟集級 speakerVoices", async () => {
    voiceLineFindMany.mockResolvedValue([{ id: "l1", content: "很久很久以前", speaker: "旁白", characterId: null }]);

    const unbound = await submitVoiceLineBatch({ userId: "u1", episode: EPISODE, lineIds: null });
    expect(unbound.submitted).toBe(0);

    const bound = await submitVoiceLineBatch({
      userId: "u1",
      episode: { ...EPISODE, speakerVoices: { 旁白: { presetId: PRESET } } },
      lineIds: null,
    });
    expect(bound.submitted).toBe(1);
  });

  // 撳兩下重配掣唔應該俾兩次錢
  it("以 dedupeActive 提交，撳兩下摺埋落同一個在途 task", async () => {
    characterFindMany.mockResolvedValue([{ id: "c1", voicePresetId: PRESET, voiceRefId: null }]);
    voiceLineFindMany.mockResolvedValue([{ id: "l1", content: "喂", speaker: "阿明", characterId: "c1" }]);

    await submitVoiceLineBatch({ userId: "u1", episode: EPISODE, lineIds: ["l1"] });

    expect(submitTask).toHaveBeenCalledWith(expect.objectContaining({ dedupeActive: true }));
  });
});
