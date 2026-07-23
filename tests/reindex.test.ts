import { describe, expect, it } from "vitest";
import { planReindex } from "@/lib/storyboard/reindex";

const shots = (indices: number[]) => indices.map((n) => ({ id: `s${n}`, shotIndex: n }));

describe("planReindex", () => {
  it("returns nothing when the run is already contiguous", () => {
    expect(planReindex(shots([1, 2, 3]))).toEqual([]);
  });

  // Deleting shot 3 leaves 1,2,4,5 — close the gap to 1,2,3,4.
  it("closes a gap left by a deleted middle shot", () => {
    expect(planReindex(shots([1, 2, 4, 5]))).toEqual([
      { id: "s4", shotIndex: 3 },
      { id: "s5", shotIndex: 4 },
    ]);
  });

  it("renumbers everything when the first shot was deleted", () => {
    expect(planReindex(shots([2, 3, 4]))).toEqual([
      { id: "s2", shotIndex: 1 },
      { id: "s3", shotIndex: 2 },
      { id: "s4", shotIndex: 3 },
    ]);
  });

  it("leaves the tail alone when only the last shot was deleted", () => {
    expect(planReindex(shots([1, 2, 3]))).toEqual([]);
  });

  // The ascending-target invariant that prevents a unique collision mid-update.
  it("emits moves in ascending target order", () => {
    const moves = planReindex(shots([3, 5, 8]));
    expect(moves.map((m) => m.shotIndex)).toEqual([1, 2, 3]);
  });

  it("sorts unordered input before planning", () => {
    expect(planReindex(shots([5, 1, 4]))).toEqual([
      { id: "s4", shotIndex: 2 },
      { id: "s5", shotIndex: 3 },
    ]);
  });

  it("handles an empty episode", () => {
    expect(planReindex([])).toEqual([]);
  });
});
