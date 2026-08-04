import { describe, it, expect } from "vitest";
import { shouldLinkToNext, isMovingCamera, type ChainShot } from "@/lib/storyboard/frame-chain";

// 尾幀錨定令接口嗰格兩條片一模一樣 —— 觀眾睇落唔再係 cut，係鏡頭一路郁過去。
// 所以呢個判定係「邊度應該連續運鏡」，唔係「邊度相鄰」。判錯係靜默壞掉：冇錯誤訊息，
// 要睇到成片先發現兩個鏡頭嘅構圖同時報廢。

const shot = (over: Partial<ChainShot> = {}): ChainShot => ({
  sceneId: "scene-1",
  shotIndex: 1,
  camera: "推",
  flashback: false,
  locationOverride: "",
  ...over,
});

describe("isMovingCamera", () => {
  it("accepts the five movement verbs from the storyboard_detail vocabulary", () => {
    for (const c of ["推", "拉", "搖", "移", "跟"]) expect(isMovingCamera(c)).toBe(true);
  });

  it("rejects 固定 and 手持", () => {
    expect(isMovingCamera("固定")).toBe(false);
    expect(isMovingCamera("手持")).toBe(false);
  });

  // 模型會飄出「手持跟拍」呢類混合寫法，入面含住「跟」字。手持本身就抖，同尾幀錨定
  // 打交，所以否決詞要贏過運動詞。
  it("lets 手持 veto a mixed phrasing that also contains a movement verb", () => {
    expect(isMovingCamera("手持跟拍")).toBe(false);
    expect(isMovingCamera("固定推鏡")).toBe(false);
  });

  it("treats an empty or unrecognised camera as not chainable", () => {
    expect(isMovingCamera("")).toBe(false);
    expect(isMovingCamera("   ")).toBe(false);
    expect(isMovingCamera("空拍")).toBe(false);
  });
});

describe("shouldLinkToNext", () => {
  it("links a moving shot to the immediately following shot in the same scene", () => {
    expect(shouldLinkToNext(shot(), shot({ shotIndex: 2 }))).toBe(true);
  });

  it("never links the last shot of a scene", () => {
    expect(shouldLinkToNext(shot(), undefined)).toBe(false);
  });

  // 另一場戲＝另一份空間契約，兩個構圖之間冇連續性可言，一定要硬切。
  it("does not link across scenes", () => {
    expect(shouldLinkToNext(shot(), shot({ shotIndex: 2, sceneId: "scene-2" }))).toBe(false);
  });

  it("does not link non-consecutive shot indexes", () => {
    expect(shouldLinkToNext(shot(), shot({ shotIndex: 3 }))).toBe(false);
    expect(shouldLinkToNext(shot({ shotIndex: 5 }), shot({ shotIndex: 4 }))).toBe(false);
  });

  // 閃回同現在之間係時空跳轉，鏡頭唔應該連續移動過去。
  it("does not link across a flashback boundary", () => {
    expect(shouldLinkToNext(shot(), shot({ shotIndex: 2, flashback: true }))).toBe(false);
    expect(shouldLinkToNext(shot({ flashback: true }), shot({ shotIndex: 2 }))).toBe(false);
  });

  it("does not link two flashbacks set in different places", () => {
    const a = shot({ flashback: true, locationOverride: "電腦前" });
    const b = shot({ shotIndex: 2, flashback: true, locationOverride: "醫院走廊" });
    expect(shouldLinkToNext(a, b)).toBe(false);
  });

  it("links two flashback shots sharing one location", () => {
    const a = shot({ flashback: true, locationOverride: "電腦前" });
    const b = shot({ shotIndex: 2, flashback: true, locationOverride: "電腦前" });
    expect(shouldLinkToNext(a, b)).toBe(true);
  });

  // 正反打對話戲通常兩邊都係固定鏡 —— 呢個正正係最唔可以鏈嘅情況。
  it("does not link a static or handheld shot even when everything else matches", () => {
    expect(shouldLinkToNext(shot({ camera: "固定" }), shot({ shotIndex: 2, camera: "固定" }))).toBe(false);
    expect(shouldLinkToNext(shot({ camera: "手持" }), shot({ shotIndex: 2, camera: "推" }))).toBe(false);
  });

  // 只睇本鏡嘅運鏡：本鏡要郁到落下一鏡個構圖度，下一鏡自己點拍唔關事。
  it("only inspects the current shot's camera, not the next one's", () => {
    expect(shouldLinkToNext(shot({ camera: "推" }), shot({ shotIndex: 2, camera: "固定" }))).toBe(true);
  });

  it("does not link when storyboard_detail dropped the shot and camera is empty", () => {
    expect(shouldLinkToNext(shot({ camera: "" }), shot({ shotIndex: 2 }))).toBe(false);
  });
});
