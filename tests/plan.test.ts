import { describe, expect, it } from "vitest";
import {
  applyHeuristicRisk,
  deleteEpisode,
  mergeIntoPrev,
  moveBoundary,
  renameEpisode,
  splitEpisode,
  summarizeRisk,
  targetHint,
  type PlanConfig,
} from "@/lib/planning/plan";
import type { PlannedEpisode } from "@/lib/prompts/schemas";

function ep(index: number, over: Partial<PlannedEpisode> = {}): PlannedEpisode {
  return {
    index,
    title: `第${index}集`,
    startAnchor: `s${index}`,
    endAnchor: `e${index}`,
    summary: `sum${index}`,
    hook: `hook${index}`,
    risk: { level: "ok", flags: [], note: "" },
    ...over,
  };
}

describe("planResult ops", () => {
  it("rename touches only the target", () => {
    const out = renameEpisode([ep(1), ep(2)], 2, "新標題");
    expect(out[1].title).toBe("新標題");
    expect(out[0].title).toBe("第1集");
  });

  it("delete renumbers 1..n", () => {
    const out = deleteEpisode([ep(1), ep(2), ep(3)], 2);
    expect(out.map((e) => e.index)).toEqual([1, 2]);
    expect(out.map((e) => e.title)).toEqual(["第1集", "第3集"]); // titles unchanged, indexes renumbered
  });

  it("merge folds into predecessor keeping the outer span", () => {
    const out = mergeIntoPrev([ep(1), ep(2), ep(3)], 2);
    expect(out).toHaveLength(2);
    expect(out[0].startAnchor).toBe("s1"); // earlier start kept
    expect(out[0].endAnchor).toBe("e2"); // later end kept
    expect(out[0].risk.level).toBe("review");
    expect(out.map((e) => e.index)).toEqual([1, 2]);
  });

  it("merge of the first episode is a no-op (nothing before it)", () => {
    const out = mergeIntoPrev([ep(1), ep(2)], 1);
    expect(out).toHaveLength(2);
  });

  it("split makes two halves at the given boundary", () => {
    const out = splitEpisode([ep(1), ep(2)], 1, "mid-end", "mid-start");
    expect(out).toHaveLength(3);
    expect(out[0].endAnchor).toBe("mid-end");
    expect(out[1].startAnchor).toBe("mid-start");
    expect(out.map((e) => e.index)).toEqual([1, 2, 3]);
  });

  it("moveBoundary updates this end + next start only", () => {
    const out = moveBoundary([ep(1), ep(2), ep(3)], 1, "newEnd", "newStart");
    expect(out[0].endAnchor).toBe("newEnd");
    expect(out[1].startAnchor).toBe("newStart");
    expect(out[2].startAnchor).toBe("s3"); // untouched
  });

  it("moveBoundary on the last episode is a no-op", () => {
    const out = moveBoundary([ep(1), ep(2)], 2, "x", "y");
    expect(out[1].endAnchor).toBe("e2");
  });
});

describe("risk", () => {
  it("summarizeRisk counts levels", () => {
    const s = summarizeRisk([
      ep(1, { risk: { level: "ok", flags: [], note: "" } }),
      ep(2, { risk: { level: "review", flags: ["too_short"], note: "" } }),
      ep(3, { risk: { level: "problem", flags: ["weak_hook"], note: "" } }),
    ]);
    expect(s).toEqual({ total: 3, ok: 1, review: 1, problem: 1 });
  });

  it("heuristic backstop flags a missing hook and over-long episode", () => {
    const cfg: PlanConfig = { anchor: "length", seconds: 90, hookStrength: "strong" };
    const eps = [ep(1, { hook: "" })]; // no hook
    const lengths = [90 * 5 * 2]; // ~180s worth of chars → too_long vs 90s target
    const out = applyHeuristicRisk(eps, lengths, cfg);
    expect(out[0].risk.flags).toContain("weak_hook");
    expect(out[0].risk.flags).toContain("too_long");
    expect(out[0].risk.level).not.toBe("ok");
  });

  it("heuristic never downgrades a model-reported problem", () => {
    const cfg: PlanConfig = { anchor: "length", seconds: 90, hookStrength: "strong" };
    const eps = [ep(1, { risk: { level: "problem", flags: ["low_density"], note: "水集" } })];
    const out = applyHeuristicRisk(eps, [90 * 5], cfg); // on-target length
    expect(out[0].risk.level).toBe("problem");
    expect(out[0].risk.flags).toContain("low_density");
  });
});

describe("targetHint", () => {
  it("phrases length vs count", () => {
    expect(targetHint({ anchor: "length", seconds: 90, hookStrength: "strong" })).toContain("90 秒");
    expect(targetHint({ anchor: "count", count: 12, hookStrength: "strong" })).toContain("12 集");
  });
});
