// placeLines 係 chip 擺位嘅單一真相：all-null 必須重現 legacy 順序 concat 行為，
// 有 offset 就釘死位置，auto 行留喺 cursor（唔可以疊返上句未完嘅位）。
import { describe, expect, it } from "vitest";
import { placeLines } from "@/lib/timeline/placement";

const line = (id: string, lineIndex: number, offsetMs: number | null, audioDurationMs: number) => ({
  id,
  lineIndex,
  offsetMs,
  audioDurationMs,
});

describe("placeLines", () => {
  it("all-null offsets → sequential placement matching legacy concat order", () => {
    const placed = placeLines([line("a", 0, null, 2000), line("b", 1, null, 1500), line("c", 2, null, 500)], 10_000);
    expect(placed.map((p) => [p.startMs, p.endMs])).toEqual([
      [0, 2000],
      [2000, 3500],
      [3500, 4000],
    ]);
    expect(placed.every((p) => p.truncatedAtMs === null)).toBe(true);
  });

  it("explicit offsets pin lines regardless of previous end", () => {
    const placed = placeLines([line("a", 0, 1000, 2000), line("b", 1, 500, 1000)], 10_000);
    expect(placed.map((p) => [p.startMs, p.endMs])).toEqual([
      [1000, 3000],
      [500, 1500],
    ]);
  });

  it("mixed: auto line after explicit line starts at the cursor (max end so far)", () => {
    // explicit line ends at 5000 → auto line starts there, not at 0
    const placed = placeLines([line("a", 0, 3000, 2000), line("b", 1, null, 1000)], 10_000);
    expect(placed[1].startMs).toBe(5000);
    expect(placed[1].endMs).toBe(6000);
  });

  it("sorts by lineIndex before placing", () => {
    const placed = placeLines([line("b", 1, null, 1000), line("a", 0, null, 2000)], 10_000);
    expect(placed.map((p) => p.lineId)).toEqual(["a", "b"]);
    expect(placed[1].startMs).toBe(2000);
  });

  it("overflow past shot end → truncatedAtMs = shotDurationMs", () => {
    const placed = placeLines([line("a", 0, 4000, 3000)], 5000);
    expect(placed[0].endMs).toBe(7000);
    expect(placed[0].truncatedAtMs).toBe(5000);
  });

  it("line exactly ending at shot end is not truncated", () => {
    const placed = placeLines([line("a", 0, 2000, 3000)], 5000);
    expect(placed[0].truncatedAtMs).toBeNull();
  });

  it("empty input → empty output", () => {
    expect(placeLines([], 5000)).toEqual([]);
  });
});
