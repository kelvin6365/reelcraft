import { describe, it, expect } from "vitest";
import { buildShotRefAssets, matchShotCharacters, pickShotLocation, type RefCharacter, type RefLocation } from "@/lib/prompts/shot-assets";

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
      { mediaId: "林知夏-body", label: "林知夏（角色全身多視角）", prompt: "林知夏 外貌" },
      { mediaId: "林知夏-face", label: "林知夏（面部特寫）", prompt: "面部身份參照" },
      { mediaId: "陳沉-body", label: "陳沉（角色全身多視角）", prompt: "陳沉 外貌" },
      { mediaId: "陳沉-face", label: "陳沉（面部特寫）", prompt: "面部身份參照" },
      { mediaId: "coffee-main", label: "咖啡店（場景主視角）", prompt: "咖啡店描述" },
    ]);
  });

  it("handles undefined shotLocation like current behavior (characters only)", () => {
    const result = buildShotRefAssets([char("林知夏")], undefined);
    expect(result).toEqual([
      { mediaId: "林知夏-body", label: "林知夏（角色全身多視角）", prompt: "林知夏 外貌" },
      { mediaId: "林知夏-face", label: "林知夏（面部特寫）", prompt: "面部身份參照" },
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
