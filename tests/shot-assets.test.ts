import { describe, it, expect } from "vitest";
import { buildShotRefAssets, MAX_SHOT_REFS, matchShotCharacters, matchShotProps, pickShotLocation, type RefCharacter, type RefLocation, type RefProp } from "@/lib/prompts/shot-assets";

const chars: RefCharacter[] = [
  { name: "林知夏", aliases: ["知夏", "夏夏"] },
  { name: "陳沉", aliases: [] },
];

describe("matchShotCharacters (⑥)", () => {
  it("matches by canonical name", () => {
    expect(matchShotCharacters(["林知夏"], chars).map((c) => c.name)).toEqual(["林知夏"]);
  });

  it("matches by alias (regression: aliases were ignored → identity anchor dropped)", () => {
    expect(matchShotCharacters(["夏夏"], chars).map((c) => c.name)).toEqual(["林知夏"]);
  });

  it("returns NO characters for an establishing shot that names none (was: dumped the whole cast)", () => {
    expect(matchShotCharacters([], chars)).toEqual([]);
  });

  it("matches multiple named characters in a two-hander", () => {
    expect(matchShotCharacters(["林知夏", "陳沉"], chars).map((c) => c.name)).toEqual(["林知夏", "陳沉"]);
  });

  it("drops blank names without matching everything", () => {
    expect(matchShotCharacters(["", "  "], chars)).toEqual([]);
  });

  // MIN_FUZZY_LEN：單字角色名唔准做 substring，否則「王」會咬走「王楚」嘅角色額度（得 2 格）
  it("does not let a single-char name fuzzy-match a longer one (MIN_FUZZY_LEN)", () => {
    const singles: RefCharacter[] = [{ name: "王" }, { name: "王楚" }];
    expect(matchShotCharacters(["王"], singles).map((c) => c.name)).toEqual(["王"]);
    expect(matchShotCharacters(["王楚"], singles).map((c) => c.name)).toEqual(["王楚"]);
  });

  it("still fuzzy-matches when both sides are long enough", () => {
    expect(matchShotCharacters(["少女林知夏"], chars).map((c) => c.name)).toEqual(["林知夏"]);
  });
});

const locs: RefLocation[] = [
  { name: "咖啡店" },
  { name: "天台" },
];

const suffixedLocs: RefLocation[] = [
  { name: "陳琳娜家客廳·日" },
  { name: "大地亚龙巢穴·日" },
];

describe("pickShotLocation (⑥)", () => {
  it("picks the location the scene actually mentions (was: always index 0)", () => {
    expect(pickShotLocation("兩人走上天台，風很大", locs)?.name).toBe("天台");
  });

  it("returns undefined when the scene matches nothing (was: silently returned index 0 → wrong location image)", () => {
    expect(pickShotLocation("室內某處", locs)).toBeUndefined();
  });

  it("returns undefined for a lone locked location the scene does not match (was: handed it over unchecked)", () => {
    expect(pickShotLocation("任何文字", [locs[0]])).toBeUndefined();
  });

  it("still returns the lone locked location when it does match", () => {
    expect(pickShotLocation("兩人坐喺咖啡店", [locs[0]])?.name).toBe("咖啡店");
  });

  it("matches scene.location against the ·時段 suffix on locked names", () => {
    expect(pickShotLocation("", suffixedLocs, "大地亚龙巢穴")?.name).toBe("大地亚龙巢穴·日");
  });

  it("matches when the script writes 巢穴外 but the locked name has no 外 (the 37/37 regression)", () => {
    expect(pickShotLocation("陳琳娜家客廳裡的燈亮著", suffixedLocs, "大地亚龙巢穴外")?.name).toBe("大地亚龙巢穴·日");
  });

  it("prefers scene.location over whatever the script text happens to mention", () => {
    expect(pickShotLocation("提到咖啡店三個字", [...locs, { name: "天台·夜" }], "天台")?.name).toBe("天台");
  });

  it("falls back to script text when scene.location is empty (legacy rows)", () => {
    expect(pickShotLocation("兩人走上天台·夜色下風很大", suffixedLocs, "")).toBeUndefined();
    expect(pickShotLocation("鏡頭掃過大地亚龙巢穴", suffixedLocs, "")?.name).toBe("大地亚龙巢穴·日");
  });

  it("returns undefined when there are no locked locations", () => {
    expect(pickShotLocation("天台", [])).toBeUndefined();
  });

  it("ignores blank locked names", () => {
    expect(pickShotLocation("天台", [{ name: "  " }])).toBeUndefined();
  });
});

const propsFixture: RefProp[] = [
  { name: "玉佩", lockedImageMediaId: "jade-main" },
  { name: "信物", lockedImageMediaId: null },
];

describe("matchShotProps", () => {
  it("matches a prop mentioned in blocking.keyProps", () => {
    expect(matchShotProps(["玉佩"], propsFixture).map((p) => p.name)).toEqual(["玉佩"]);
  });

  it("returns no props when keyProps is empty (was: risk of dumping whole prop library)", () => {
    expect(matchShotProps([], propsFixture)).toEqual([]);
  });

  it("fuzzy-matches substrings both ways", () => {
    expect(matchShotProps(["桌上的玉佩"], propsFixture).map((p) => p.name)).toEqual(["玉佩"]);
  });

  it("drops blank keyProps without matching everything", () => {
    expect(matchShotProps(["", "  "], propsFixture)).toEqual([]);
  });
});

// Gemini 2.5 Flash Image 官方 max 3 張輸入圖；而且模型跟「最後一張」嘅 aspect ratio，
// 所以配額固定為：場景 1 張排最前 + 角色最多 2 張排最後（角色圖係 9:16，帶出 9:16 成品）。
describe("buildShotRefAssets — quota & ordering (Gemini max-3)", () => {
  const char = (name: string, opts: Partial<{ lockedImageMediaId: string | null; faceImageMediaId: string | null }> = {}) => ({
    name,
    appearancePrompt: `${name} 外貌`,
    lockedImageMediaId: opts.lockedImageMediaId === undefined ? `${name}-body` : opts.lockedImageMediaId,
    faceImageMediaId: opts.faceImageMediaId === undefined ? `${name}-face` : opts.faceImageMediaId,
  });

  it("exports MAX_SHOT_REFS = 3", () => {
    expect(MAX_SHOT_REFS).toBe(3);
  });

  it("puts the location first and characters last, capped at 3", () => {
    const shotLocation = { name: "咖啡店", prompt: "咖啡店描述", lockedImageMediaId: "coffee-main" };
    const { refs, droppedCharacters } = buildShotRefAssets([char("林知夏"), char("陳沉")], shotLocation);
    expect(refs).toEqual([
      { mediaId: "coffee-main", label: "咖啡店（場景主視角）", prompt: "咖啡店描述" },
      { mediaId: "林知夏-face", label: "林知夏（面部特寫）", prompt: "林知夏 外貌", identityAnchor: true },
      { mediaId: "陳沉-face", label: "陳沉（面部特寫）", prompt: "陳沉 外貌", identityAnchor: true },
    ]);
    expect(refs).toHaveLength(MAX_SHOT_REFS);
    expect(droppedCharacters).toEqual([]);
  });

  // 近臉圖要行 outbound-image 嘅高解析路徑（2048/q92），全身圖同場景圖照舊壓 1024。
  // 壓錯路徑 = 塊臉 IED 剩返 30-40px，低過 ISO 最低 90px 一半，等於白送。
  it("flags only the face close-up as an identity anchor", () => {
    const shotLocation = { name: "咖啡店", prompt: "咖啡店描述", lockedImageMediaId: "coffee-main" };
    const { refs } = buildShotRefAssets([char("林知夏"), char("陳沉", { faceImageMediaId: null })], shotLocation);
    expect(refs.map((r) => [r.label, r.identityAnchor === true])).toEqual([
      ["咖啡店（場景主視角）", false],
      ["林知夏（面部特寫）", true],
      ["陳沉（角色全身正面）", false],
    ]);
  });

  it("prefers the face close-up, falling back to the full-body locked image", () => {
    const { refs } = buildShotRefAssets([char("林知夏", { faceImageMediaId: null })], undefined);
    expect(refs).toEqual([{ mediaId: "林知夏-body", label: "林知夏（角色全身正面）", prompt: "林知夏 外貌" }]);
  });

  it("gives an establishing shot with no characters just the location image", () => {
    const shotLocation = { name: "天台", prompt: "天台描述", lockedImageMediaId: "roof-main" };
    const { refs, droppedCharacters } = buildShotRefAssets([], shotLocation);
    expect(refs).toEqual([{ mediaId: "roof-main", label: "天台（場景主視角）", prompt: "天台描述" }]);
    expect(droppedCharacters).toEqual([]);
  });

  it("returns no refs at all when there is neither a locked location nor a locked character", () => {
    const { refs, droppedCharacters } = buildShotRefAssets([char("甲", { lockedImageMediaId: null, faceImageMediaId: null })], undefined);
    expect(refs).toEqual([]);
    expect(droppedCharacters).toEqual([{ name: "甲", appearancePrompt: "甲 外貌" }]);
  });

  it("reports the 3rd+ character as dropped, keeping shotCharacters order (= importance)", () => {
    const shotLocation = { name: "場景", prompt: "場景描述", lockedImageMediaId: "scene-main" };
    const { refs, droppedCharacters } = buildShotRefAssets([char("甲"), char("乙"), char("丙"), char("丁")], shotLocation);
    expect(refs.map((r) => r.mediaId)).toEqual(["scene-main", "甲-face", "乙-face"]);
    expect(droppedCharacters).toEqual([
      { name: "丙", appearancePrompt: "丙 外貌" },
      { name: "丁", appearancePrompt: "丁 外貌" },
    ]);
  });

  it("caps characters at 2 even with no location image (the 3rd slot is not reused)", () => {
    const { refs, droppedCharacters } = buildShotRefAssets([char("甲"), char("乙"), char("丙")], undefined);
    expect(refs.map((r) => r.mediaId)).toEqual(["甲-face", "乙-face"]);
    expect(droppedCharacters.map((c) => c.name)).toEqual(["丙"]);
  });

  it("never sends props, location angles or character side views (no room in 3 slots)", () => {
    const shotLocation = {
      name: "天台",
      prompt: "天台描述",
      lockedImageMediaId: "roof-main",
      angles: [{ label: "仰視", prompt: "仰視角度", mediaId: "roof-angle-2" }],
    };
    const withViews = { ...char("林知夏"), views: [{ label: "側面", prompt: "", mediaId: "m-side" }] };
    const shotProps: RefProp[] = [
      { name: "玉佩", prompt: "玉佩描述", lockedImageMediaId: "jade-main", views: [{ label: "正面", prompt: "正面描述", mediaId: "jade-front" }] },
    ];
    const { refs } = buildShotRefAssets([withViews], shotLocation, shotProps);
    expect(refs.map((r) => r.mediaId)).toEqual(["roof-main", "林知夏-face"]);
  });
});
