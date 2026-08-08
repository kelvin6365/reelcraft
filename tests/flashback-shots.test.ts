import { describe, expect, it, vi, afterEach } from "vitest";
import { flashbackRanges, markFlashbackShots, type FlashbackCandidateShot } from "@/lib/storyboard/flashback";

// 上一輪把閃回切做獨立場景（splitFlashbackScenes，已移除）。實跑之後見到切場嘅代價比佢
// 解決嗰樣嘢貴：同一個地點被斬成三場，各自鎖一份空間契約 → 跳軸；碎片冇原文錨點。
// 而家母場保持完整，閃回改喺鏡頭層標記。以下測試鎖住呢個決定。
const SCENE =
  "王楚站在龙巢穴前，握紧手中的长剑，深吸一口气。" + // 0..
  "（画面闪回：王楚坐在电脑前，手指飞舞，屏幕上是密密麻麻的攻略笔记。）" +
  "他回过神来，抬头看向巢穴深处那团黑影，一步步走了进去。";

const shot = (index: number, source_text: string, over: Partial<FlashbackCandidateShot> = {}): FlashbackCandidateShot => ({
  index,
  source_text,
  ...over,
});

describe("flashbackRanges", () => {
  it("marks the parenthetical itself when there is no 回到現在 marker", () => {
    const [r] = flashbackRanges(SCENE);
    expect(SCENE.slice(r.start, r.end)).toBe("（画面闪回：王楚坐在电脑前，手指飞舞，屏幕上是密密麻麻的攻略笔记。）");
  });

  // 有回切註記就覆蓋跨段閃回；註記本身屬於「回到現在」嗰段，所以區間止喺佢之前。
  it("runs to the 回到現在 marker when there is one, excluding the marker", () => {
    const content = "王楚深吸一口气。（闪回开始）两年前，他还是个新人，每晚都在电脑前记攻略。（画面拉回现在）他抬头看向黑影。";
    const [r] = flashbackRanges(content);
    expect(content.slice(r.start, r.end)).toContain("两年前");
    expect(content.slice(r.start, r.end)).not.toContain("画面拉回");
  });

  // 對白入面嘅「兩年前」係時間狀語唔係畫面跳轉 —— 認咗就會誤標成場戲，剝走佢哋真正
  // 需要嘅場景參考圖。方向保守：寧願漏網。
  it("ignores a bare time adverbial in prose", () => {
    expect(flashbackRanges("「两年前他就是这样说的，」李雪晴低声道。王楚点了点头。")).toEqual([]);
  });

  it("never throws on empty content", () => {
    expect(flashbackRanges("")).toEqual([]);
  });
});

describe("markFlashbackShots", () => {
  afterEach(() => vi.restoreAllMocks());

  it("marks only the shots whose source_text sits inside the flashback", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const marks = markFlashbackShots("sc-1", SCENE, [
      shot(1, "王楚站在龙巢穴前，握紧手中的长剑，深吸一口气。"),
      shot(2, "（画面闪回：王楚坐在电脑前，手指飞舞，屏幕上是密密麻麻的攻略笔记。）", { flashback_location: "电脑前" }),
      shot(3, "他回过神来，抬头看向巢穴深处那团黑影，一步步走了进去。"),
    ]);
    expect(marks.map((m) => m.flashback)).toEqual([false, true, false]);
    // 閃回鏡自己嘅地點文字保留 —— 佢冇場景參考圖，環境全靠呢句
    expect(marks[1].locationOverride).toBe("电脑前");
    // 非閃回鏡一律唔准帶 locationOverride（地點由 Scene.location 權威決定）
    expect(marks[0].locationOverride).toBe("");
    expect(marks[2].locationOverride).toBe("");
  });

  // 母場保持完整先係呢一輪嘅重點：三鏡仍然屬於同一場、同一份空間契約。
  it("keeps every shot in the same scene — no splitting, only marking", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [shot(1, "王楚站在龙巢穴前"), shot(2, "（画面闪回：王楚坐在电脑前，手指飞舞"), shot(3, "他回过神来")];
    expect(markFlashbackShots("sc-1", SCENE, shots)).toHaveLength(shots.length);
  });

  // 程式只認括號註記，冇註記嘅閃回（純敘述）一定漏 —— 模型自報補呢個窿。
  // 誤判代價唔對稱：誤標 = 冇場景圖（中性背景，睇得出）；漏標 = 用錯背景（靜默壞）。
  it("ORs in the model's own flag so unbracketed flashbacks are still caught", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const content = "王楚站在龙巢穴前。两年前他还是个新人，每晚都在电脑前记攻略。他抬头看向黑影。";
    const marks = markFlashbackShots("sc-1", content, [
      shot(1, "王楚站在龙巢穴前。"),
      shot(2, "两年前他还是个新人，每晚都在电脑前记攻略。", { flashback: true, flashback_location: "電腦前" }),
      shot(3, "他抬头看向黑影。"),
    ]);
    expect(marks.map((m) => m.flashback)).toEqual([false, true, false]);
    expect(marks[1].locationOverride).toBe("電腦前");
  });

  // 模型失控（成場都標閃回而原文一個註記都冇）→ 照收就等於成場戲冇晒場景參考圖。
  it("ignores the model when it flags every shot and the text has no marker at all", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const content = "王楚走进巢穴，火把照亮墙上的爪痕。李雪晴在洞口等待。";
    const marks = markFlashbackShots("sc-1", content, [
      shot(1, "王楚走进巢穴，火把照亮墙上的爪痕。", { flashback: true }),
      shot(2, "李雪晴在洞口等待。", { flashback: true }),
    ]);
    expect(marks.map((m) => m.flashback)).toEqual([false, false]);
    expect(warn.mock.calls.flat().join(" ")).toContain("當佢失控");
  });

  // 一鏡都唔標嗰陣唔應該嘈 —— warn 係留痕，唔係雜訊。
  it("stays quiet on a scene with no flashback at all", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const content = "王楚走进巢穴，火把照亮墙上的爪痕。李雪晴在洞口等待。";
    const marks = markFlashbackShots("sc-1", content, [shot(1, "王楚走进巢穴，火把照亮墙上的爪痕。"), shot(2, "李雪晴在洞口等待。")]);
    expect(marks.every((m) => !m.flashback)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  // source_text 要求「可被追溯回原文」，但模型會順手潤色 —— 定位失敗唔可以一律當非閃回。
  it("falls back to shot order when source_text was rewritten and cannot be located", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const marks = markFlashbackShots("sc-1", SCENE, [
      shot(1, "王楚在巢穴外持劍準備"),
      shot(2, "王楚在電腦前打攻略筆記"),
      shot(3, "王楚步入巢穴深處"),
    ]);
    expect(marks[1].flashback).toBe(true);
  });

  it("never throws on empty shots or empty content", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() => markFlashbackShots("sc-1", "", [])).not.toThrow();
    expect(markFlashbackShots("sc-1", "", [shot(1, "")])).toEqual([{ flashback: false, locationOverride: "" }]);
  });

  // /g regex 嘅 test() 會記住 lastIndex — 唔重置就第二個閃回鏡漏認。
  it("detects a marker in every shot's source_text, not just the first", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const marks = markFlashbackShots("sc-1", "無關原文", [
      shot(1, "（回忆：他在电脑前）"),
      shot(2, "（回忆：他在电脑前继续记笔记）"),
    ]);
    expect(marks.map((m) => m.flashback)).toEqual([true, true]);
  });

  // 模型會把「地點」欄位當 summary 用 —— 截短，呢個位只係一句環境描述。
  it("truncates an over-long flashback_location", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const marks = markFlashbackShots("sc-1", SCENE, [shot(1, "（画面闪回：王楚坐在电脑前", { flashback_location: "地".repeat(80) })]);
    expect(marks[0].locationOverride.length).toBe(40);
  });
});
