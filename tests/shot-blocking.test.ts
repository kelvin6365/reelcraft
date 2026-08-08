import { describe, expect, it } from "vitest";
import { filterBlockingForShot, formatBlocking } from "@/lib/prompts/shot-blocking";

// 空間契約係一場一份，生圖係一鏡一次。契約原封不動塞入單鏡 prompt（而模板要求硬性遵守）
// 就會繞過 characters 層所有防線 —— 實測第 11 鏡 characters 鎖死做兩個人，出圖仍然多咗
// 三個雜兵，因為契約列晒五個人嘅落位。以下測試鎖住「逐鏡收窄、但軸線唔郁」呢個決定。
const SCENE_BLOCKING = {
  cameraAxis: "鏡頭一律在洞口的一側，不越軸",
  positions: [
    { name: "鄭夏雨", screenSide: "left", facing: "面向畫面右", placement: "站洞口正前" },
    { name: "李雪晴", screenSide: "right", facing: "面向畫面左" },
    { name: "安吉拉", screenSide: "center" },
    { name: "艾琳", screenSide: "right" },
    { name: "王楚", screenSide: "left", placement: "站後方岩壁邊" },
  ],
  keyProps: ["鄭夏雨的劍=出鞘，握在右手", "巨龍=倒塌", "安吉拉的法杖=緊握", "艾琳的弓=手中握著"],
};

describe("filterBlockingForShot", () => {
  it("keeps only the positions of characters present in this shot", () => {
    const { blocking, droppedPositions } = filterBlockingForShot(SCENE_BLOCKING, ["鄭夏雨", "王楚"]);
    expect(blocking.positions?.map((p) => p.name)).toEqual(["鄭夏雨", "王楚"]);
    expect(droppedPositions).toEqual(["李雪晴", "安吉拉", "艾琳"]);
  });

  // 軸線係成場共用嘅連戲依據，過濾走就等於親手拆咗跨鏡連戲。
  it("never filters cameraAxis — it is the scene-wide continuity anchor", () => {
    const { blocking } = filterBlockingForShot(SCENE_BLOCKING, []);
    expect(blocking.cameraAxis).toBe("鏡頭一律在洞口的一側，不越軸");
    expect(blocking.positions).toEqual([]);
  });

  it("drops keyProps that name a character absent from this shot", () => {
    const { blocking, droppedProps } = filterBlockingForShot(SCENE_BLOCKING, ["鄭夏雨", "王楚"]);
    expect(blocking.keyProps).toEqual(["鄭夏雨的劍=出鞘，握在右手", "巨龍=倒塌"]);
    expect(droppedProps).toEqual(["安吉拉的法杖=緊握", "艾琳的弓=手中握著"]);
  });

  // 冇持有者嘅道具係真正嘅全場連戲資訊（呢場戲入面條龍就係死咗），逐鏡都要保留。
  it("keeps ownerless props even when the shot has no characters at all", () => {
    const { blocking } = filterBlockingForShot(SCENE_BLOCKING, []);
    expect(blocking.keyProps).toEqual(["巨龍=倒塌"]);
  });

  // 名互為子串（「王楚」vs「王楚天」）：短嗰個唔可以攞嚟做剝除依據，否則會剝走一件
  // 真係喺本鏡嘅道具。方向保守 —— 寧願漏剝。
  it("does not drop a present character's prop because a shorter name is a substring", () => {
    const raw = {
      cameraAxis: "不越軸",
      positions: [{ name: "王楚天", screenSide: "left" }, { name: "王楚", screenSide: "right" }],
      keyProps: ["王楚天的劍=出鞘"],
    };
    const { blocking } = filterBlockingForShot(raw, ["王楚天"], ["王楚天", "王楚"]);
    expect(blocking.keyProps).toEqual(["王楚天的劍=出鞘"]);
  });

  // 契約有落位但未必抽咗做鎖定角色，淨靠 knownCharacterNames 會漏認人名。
  it("treats contract position names as character names when spotting prop owners", () => {
    const raw = {
      cameraAxis: "不越軸",
      positions: [{ name: "老陳", screenSide: "left" }, { name: "阿May", screenSide: "right" }],
      keyProps: ["老陳的煙斗=叼在嘴角"],
    };
    const { blocking, droppedProps } = filterBlockingForShot(raw, ["阿May"], []);
    expect(blocking.keyProps).toEqual([]);
    expect(droppedProps).toEqual(["老陳的煙斗=叼在嘴角"]);
  });

  // 閃回鏡唔喺母場嗰個空間：母場軸線寫住「鏡頭一律喺洞口一側」，而閃回係兩年前屋企
  // 電腦前。硬套落去唔係連戲，係塞一句唔相干嘅硬性指示。呢度係唯一一個連 cameraAxis
  // 都要剝嘅情況。
  it("strips the entire contract — cameraAxis included — for a flashback shot", () => {
    const { blocking, droppedPositions, droppedProps } = filterBlockingForShot(SCENE_BLOCKING, ["王楚"], [], { flashback: true });
    expect(blocking.cameraAxis).toBe("");
    expect(blocking.positions).toEqual([]);
    expect(blocking.keyProps).toEqual([]);
    // 剝走嘅嘢照樣要留痕
    expect(droppedPositions).toContain("鄭夏雨");
    expect(droppedProps).toContain("巨龍=倒塌");
  });

  it("never throws on a missing or malformed blocking", () => {
    expect(() => filterBlockingForShot(null, ["王楚"])).not.toThrow();
    expect(filterBlockingForShot(null, ["王楚"]).blocking.positions).toEqual([]);
    expect(filterBlockingForShot({ positions: "nope", keyProps: 3 }, ["王楚"]).blocking.keyProps).toEqual([]);
  });
});

describe("formatBlocking", () => {
  it("renders axis, positions and props", () => {
    const { blocking } = filterBlockingForShot(SCENE_BLOCKING, ["鄭夏雨", "王楚"]);
    const text = formatBlocking(blocking);
    expect(text).toContain("軸線：鏡頭一律在洞口的一側，不越軸");
    expect(text).toContain("鄭夏雨=畫面左、面向畫面右、站洞口正前");
    expect(text).toContain("道具：鄭夏雨的劍=出鞘，握在右手、巨龍=倒塌");
    expect(text).not.toContain("艾琳");
  });

  // 過濾到一個落位都唔剩（空鏡／物件鏡）時唔可以出「軸線：…；」呢種爛尾字串 ——
  // 模板會把契約當硬性指示讀，一段空白等於叫模型自己填。
  it("keeps a sensible fallback when every position was filtered out", () => {
    const { blocking } = filterBlockingForShot(SCENE_BLOCKING, []);
    const text = formatBlocking(blocking);
    expect(text).toContain("軸線：鏡頭一律在洞口的一側，不越軸");
    expect(text).toContain("本鏡無指定角色落位");
    expect(text).not.toMatch(/；；/);
  });

  // 閃回鏡冇場景參考圖（pickShotLocation 一律唔畀），所以呢句文字係佢唯一一次交代
  // 自己身在何處嘅機會。唔明講「唔好沿用本場環境」，模型會由 subject／對白推返個母場出嚟。
  it("renders the flashback line with its location text instead of the scene contract", () => {
    const text = formatBlocking(SCENE_BLOCKING, { flashback: true, locationOverride: "電腦前" });
    expect(text).toContain("本鏡屬閃回");
    expect(text).toContain("地點：電腦前");
    expect(text).toContain("嚴禁沿用本場嘅場景");
    expect(text).not.toContain("洞口");
    expect(text).not.toContain("鄭夏雨");
  });

  // 認唔出地點都唔可以留白 —— 留白等於叫模型自己填，佢就會填返母場。
  it("still forbids reusing the scene's environment when the flashback location is unknown", () => {
    const text = formatBlocking(SCENE_BLOCKING, { flashback: true, locationOverride: "" });
    expect(text).toContain("原文冇明講地點");
    expect(text).toContain("嚴禁沿用本場嘅場景");
  });

  it("falls back to the no-contract line when there is neither axis nor positions", () => {
    expect(formatBlocking(null)).toContain("無空間契約");
    expect(formatBlocking({ keyProps: ["劍=出鞘"] })).toContain("無空間契約");
  });
});
