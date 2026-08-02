import { describe, expect, it, vi, afterEach } from "vitest";
import { splitFlashbackScenes, type SceneDraft } from "@/lib/workers/handlers/text-handlers";

// build_scenes.zh.txt 加咗兩次「時間／地點跳躍必須切場」都仍然係 2 場，閃回照樣夾喺場景 1
// 之內 —— 模型把元素配額當成可以壓過硬性規則。呢層做程式切場：認括號旁白標記，切完令閃回
// 有自己嘅 location 欄位（留空，寧願冇場景參考圖都好過用錯背景）。
const base = (over: Partial<SceneDraft> = {}): SceneDraft => ({
  content: "",
  anchorStart: "開場錨點",
  anchorEnd: "結尾錨點",
  summary: "王楚在龍巢穴前準備",
  location: "大地亚龙巢穴",
  timeOfDay: "夜",
  ...over,
});

describe("splitFlashbackScenes", () => {
  afterEach(() => vi.restoreAllMocks());

  it("splits an embedded flashback into three scenes (before / flashback / after)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const content =
      "王楚站在龙巢穴前，握紧手中的长剑，深吸一口气。" +
      "（画面闪回：王楚坐在电脑前，手指飞舞，屏幕上是密密麻麻的攻略笔记。）" +
      "他回过神来，抬头看向巢穴深处那团黑影，一步步走了进去。";
    const out = splitFlashbackScenes("ep-1", [base({ content })]);

    expect(out).toHaveLength(3);
    expect(out.map((s) => s.content).join("")).toBe(content); // 一個字都唔准丟
    expect(out[1].content).toContain("画面闪回");
    // 閃回場：location 留空 → pickShotLocation 會退返去掃原文，掃唔到就唔畀場景參考圖
    expect(out[1].location).toBe("");
    expect(out[1].timeOfDay).toBe("");
    expect(out[1].summary).toContain("閃回");
    // 前後兩截仍然係外層場景嗰個時空
    expect(out[0].location).toBe("大地亚龙巢穴");
    expect(out[2].location).toBe("大地亚龙巢穴");
    expect(warn.mock.calls[0][0]).toContain("ep-1");
  });

  it("keeps the model's real anchors only on the outer edges", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const out = splitFlashbackScenes("ep-1", [
      base({
        content:
          "王楚站在龙巢穴前握紧长剑深吸一口气。（画面闪回：王楚坐在电脑前，手指飞舞。）他回过神来走了进去。",
      }),
    ]);
    expect(out[0].anchorStart).toBe("開場錨點");
    expect(out[0].anchorEnd).toBe("");
    expect(out[1].anchorStart).toBe("");
    expect(out[1].anchorEnd).toBe("");
    expect(out[2].anchorStart).toBe("");
    expect(out[2].anchorEnd).toBe("結尾錨點");
  });

  it("runs the flashback up to the 回到現在 marker when there is one", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const content =
      "王楚站在龙巢穴前深吸一口气。" +
      "（闪回开始）两年前，他还是个默默无闻的新人，每晚都在电脑前记攻略。" +
      "（画面拉回现在）他抬头看向巢穴深处那团黑影。";
    const out = splitFlashbackScenes("ep-1", [base({ content })]);
    expect(out).toHaveLength(3);
    expect(out[1].content).toContain("两年前");
    expect(out[1].content).not.toContain("画面拉回"); // 回切註記屬於「回到現在」嗰場
    expect(out[2].content.startsWith("（画面拉回现在）")).toBe(true);
    expect(out.map((s) => s.content).join("")).toBe(content);
  });

  // 對白入面嘅「兩年前」係時間狀語唔係畫面跳轉——照切就會把一場戲斬到粉碎。
  it("does not split on a bare time adverbial in prose", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const content = "「两年前他就是这样说的，」李雪晴低声道，「你还记得吗？」王楚点了点头。";
    const out = splitFlashbackScenes("ep-1", [base({ content })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(base({ content }));
    expect(warn).not.toHaveBeenCalled();
  });

  it("leaves scenes the model already split correctly untouched", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const scenes = [base({ content: "王楚走进巢穴，火把照亮墙上的爪痕。" }), base({ content: "李雪晴在洞口等待。" })];
    expect(splitFlashbackScenes("ep-1", scenes)).toEqual(scenes);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not emit a scene too short to storyboard — tiny fragments merge, never drop", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const content = "他愣住。（画面闪回：王楚坐在电脑前，手指飞舞，屏幕上全是攻略笔记。）他回过神来，走了进去。";
    const out = splitFlashbackScenes("ep-1", [base({ content })]);
    expect(out).toHaveLength(2); // 「他愣住。」太碎，併入閃回段
    expect(out.map((s) => s.content).join("")).toBe(content);
    for (const s of out) expect(s.content.trim().length).toBeGreaterThanOrEqual(8);
  });

  it("never throws on empty or marker-only content", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() => splitFlashbackScenes("ep-1", [])).not.toThrow();
    expect(() => splitFlashbackScenes("ep-1", [base({ content: "" })])).not.toThrow();
    expect(splitFlashbackScenes("ep-1", [base({ content: "（闪回）" })])).toHaveLength(1);
  });
});
