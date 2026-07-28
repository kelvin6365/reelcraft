import { describe, it, expect } from "vitest";
import { buildShotRefAssets, matchShotCharacters, matchShotProps, pickShotLocation, type RefCharacter, type RefLocation, type RefProp } from "@/lib/prompts/shot-assets";

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
});

const locs: RefLocation[] = [
  { name: "咖啡店" },
  { name: "天台" },
];

describe("pickShotLocation (⑥)", () => {
  it("returns the single locked location without scanning", () => {
    expect(pickShotLocation("任何文字", [locs[0]])?.name).toBe("咖啡店");
  });

  it("picks the location the scene actually mentions (was: always index 0)", () => {
    expect(pickShotLocation("兩人走上天台，風很大", locs)?.name).toBe("天台");
  });

  it("falls back to the first when the scene mentions none", () => {
    expect(pickShotLocation("室內某處", locs)?.name).toBe("咖啡店");
  });

  it("returns undefined when there are no locked locations", () => {
    expect(pickShotLocation("天台", [])).toBeUndefined();
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

describe("buildShotRefAssets — props (Prop asset design)", () => {
  it("appends a locked prop's main view after location, skipping unlocked props", () => {
    const shotLocation = { name: "咖啡店", prompt: "咖啡店描述", lockedImageMediaId: "coffee-main" };
    const shotProps: RefProp[] = [
      { name: "玉佩", prompt: "玉佩描述", lockedImageMediaId: "jade-main" },
      { name: "信物", prompt: "信物描述", lockedImageMediaId: null },
    ];
    const result = buildShotRefAssets([], shotLocation, shotProps);
    expect(result).toEqual([
      { mediaId: "coffee-main", label: "咖啡店（場景主視角）", prompt: "咖啡店描述" },
      { mediaId: "jade-main", label: "玉佩（道具主視角）", prompt: "玉佩描述" },
    ]);
  });

  it("includes non-null prop views after the prop's main image", () => {
    const shotProps: RefProp[] = [
      {
        name: "玉佩",
        prompt: "玉佩描述",
        lockedImageMediaId: "jade-main",
        views: [
          { label: "正面", prompt: "正面描述", mediaId: "jade-front" },
          { label: "反面", prompt: "反面描述", mediaId: null },
        ],
      },
    ];
    const result = buildShotRefAssets([], undefined, shotProps);
    expect(result).toEqual([
      { mediaId: "jade-main", label: "玉佩（道具主視角）", prompt: "玉佩描述" },
      { mediaId: "jade-front", label: "玉佩（道具視角：正面）", prompt: "正面描述" },
    ]);
  });

  it("still truncates to MAX_SHOT_REFS(6) when props push it over", () => {
    const char = (name: string) => ({ name, appearancePrompt: `${name} 外貌`, lockedImageMediaId: `${name}-body`, faceImageMediaId: `${name}-face` });
    const shotCharacters = [char("甲"), char("乙"), char("丙")];
    const shotProps: RefProp[] = [{ name: "玉佩", prompt: "玉佩描述", lockedImageMediaId: "jade-main" }];
    const result = buildShotRefAssets(shotCharacters, undefined, shotProps);
    expect(result).toHaveLength(6);
    expect(result.map((a) => a.mediaId)).not.toContain("jade-main");
  });
});

describe("buildShotRefAssets (PR4)", () => {
  const char = (name: string, opts: Partial<{ lockedImageMediaId: string | null; faceImageMediaId: string | null }> = {}) => ({
    name,
    appearancePrompt: `${name} 外貌`,
    lockedImageMediaId: opts.lockedImageMediaId ?? `${name}-body`,
    faceImageMediaId: opts.faceImageMediaId ?? `${name}-face`,
  });

  it("matches current behavior with no angles: characters (locked+face) then scene main image", () => {
    const shotCharacters = [char("林知夏"), char("陳沉")];
    const shotLocation = { name: "咖啡店", prompt: "咖啡店描述", lockedImageMediaId: "coffee-main" };
    const result = buildShotRefAssets(shotCharacters, shotLocation);
    expect(result).toEqual([
      { mediaId: "林知夏-body", label: "林知夏（角色全身正面）", prompt: "林知夏 外貌" },
      { mediaId: "林知夏-face", label: "林知夏（面部特寫）", prompt: "面部身份參照" },
      { mediaId: "陳沉-body", label: "陳沉（角色全身正面）", prompt: "陳沉 外貌" },
      { mediaId: "陳沉-face", label: "陳沉（面部特寫）", prompt: "面部身份參照" },
      { mediaId: "coffee-main", label: "咖啡店（場景主視角）", prompt: "咖啡店描述" },
    ]);
  });

  it("handles undefined shotLocation like current behavior (characters only)", () => {
    const result = buildShotRefAssets([char("林知夏")], undefined);
    expect(result).toEqual([
      { mediaId: "林知夏-body", label: "林知夏（角色全身正面）", prompt: "林知夏 外貌" },
      { mediaId: "林知夏-face", label: "林知夏（面部特寫）", prompt: "面部身份參照" },
    ]);
  });

  it("includes a character's non-null views after its front image and face close-up", () => {
    const withViews = { ...char("林知夏"), views: [{ label: "側面", prompt: "", mediaId: "m-side" }] };
    const result = buildShotRefAssets([withViews], undefined);
    expect(result).toEqual([
      { mediaId: "林知夏-body", label: "林知夏（角色全身正面）", prompt: "林知夏 外貌" },
      { mediaId: "林知夏-face", label: "林知夏（面部特寫）", prompt: "面部身份參照" },
      { mediaId: "m-side", label: "林知夏（側面）", prompt: "同一角色的其他視角參照" },
    ]);
  });

  it("filters out angles with null mediaId and formats label for non-null ones", () => {
    const shotLocation = {
      name: "天台",
      prompt: "天台描述",
      lockedImageMediaId: "roof-main",
      angles: [
        { label: "俯視", prompt: "俯視角度", mediaId: null },
        { label: "仰視", prompt: "仰視角度", mediaId: "roof-angle-2" },
      ],
    };
    const result = buildShotRefAssets([], shotLocation);
    expect(result).toEqual([
      { mediaId: "roof-main", label: "天台（場景主視角）", prompt: "天台描述" },
      { mediaId: "roof-angle-2", label: "天台（場景視角：仰視）", prompt: "仰視角度" },
    ]);
  });

  it("truncates beyond MAX_SHOT_REFS(6), dropping angles before characters/main image", () => {
    const shotCharacters = [char("甲", { faceImageMediaId: "甲-face" }), char("乙", { faceImageMediaId: "乙-face" }), char("丙", { faceImageMediaId: "丙-face" })];
    const shotLocation = {
      name: "場景",
      prompt: "場景描述",
      lockedImageMediaId: "scene-main",
      angles: [
        { label: "角度A", prompt: "A", mediaId: "angle-a" },
        { label: "角度B", prompt: "B", mediaId: "angle-b" },
      ],
    };
    // 3 chars * 2 refs (body+face) = 6, + main image = 7, + 2 angles = 9
    const result = buildShotRefAssets(shotCharacters, shotLocation);
    expect(result).toHaveLength(6);
    expect(result.map((a) => a.mediaId)).toEqual(["甲-body", "甲-face", "乙-body", "乙-face", "丙-body", "丙-face"]);
  });
});
