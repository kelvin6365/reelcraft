// placeLines 係 chip 擺位嘅單一真相：all-null 必須重現 legacy 順序 concat 行為，
// 有 offset 就釘死位置，auto 行留喺 cursor（唔可以疊返上句未完嘅位）。
import { describe, expect, it } from "vitest";
import { padClip, placeLines, placeLinesPadded } from "@/lib/timeline/placement";

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

describe("padClip", () => {
  it("no overflow → no pad", () => {
    expect(padClip(5000, 4000)).toEqual({ paddedMs: 5000, padMs: 0 });
  });

  it("pads to needed length within cap", () => {
    expect(padClip(5000, 8000)).toEqual({ paddedMs: 8000, padMs: 3000 });
  });

  it("2x cap binds for short clips", () => {
    // clip 3s：cap = min(6000, 9000) = 6000
    expect(padClip(3000, 12_000)).toEqual({ paddedMs: 6000, padMs: 3000 });
  });

  it("+6s cap binds for long clips", () => {
    // clip 10s：cap = min(20000, 16000) = 16000
    expect(padClip(10_000, 20_000)).toEqual({ paddedMs: 16_000, padMs: 6000 });
  });

  it("never shrinks below clip length", () => {
    expect(padClip(5000, 0)).toEqual({ paddedMs: 5000, padMs: 0 });
  });
});

describe("placeLinesPadded", () => {
  it("positions identical to raw placeLines; flags recomputed vs paddedMs", () => {
    // clip 3s，兩句共 5s → padded 到 5s（cap 6s 內）→ 齊句唔再截
    const lines = [line("a", 0, null, 2000), line("b", 1, null, 3000)];
    const { placed, clipMs, paddedMs, padMs } = placeLinesPadded(lines, 3000);
    expect(clipMs).toBe(3000);
    expect(paddedMs).toBe(5000);
    expect(padMs).toBe(2000);
    expect(placed.map((p) => [p.startMs, p.endMs])).toEqual(placeLines(lines, 3000).map((p) => [p.startMs, p.endMs]));
    expect(placed.every((p) => p.truncatedAtMs === null)).toBe(true);
  });

  it("beyond-cap audio still truncates at paddedMs", () => {
    // clip 3s cap 6s，一句 10s → truncatedAtMs = 6000
    const { placed, paddedMs } = placeLinesPadded([line("a", 0, null, 10_000)], 3000);
    expect(paddedMs).toBe(6000);
    expect(placed[0].truncatedAtMs).toBe(6000);
  });

  it("no audio → padMs 0", () => {
    expect(placeLinesPadded([], 4000)).toMatchObject({ paddedMs: 4000, padMs: 0, placed: [] });
  });
});
