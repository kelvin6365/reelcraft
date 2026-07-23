import { describe, it, expect } from "vitest";
import { matchShotCharacters, pickShotLocation, type RefCharacter, type RefLocation } from "@/lib/prompts/shot-assets";

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
