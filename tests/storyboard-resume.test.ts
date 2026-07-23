import { describe, expect, it } from "vitest";
import { planResume } from "@/lib/storyboard/resume";

const scenes = [{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }, { id: "s5" }];

describe("planResume", () => {
  it("builds everything on a first run", () => {
    const p = planResume(scenes, []);
    expect(p.toBuild.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    expect(p.keepSceneIds).toEqual([]);
    expect(p.skipped).toBe(0);
  });

  it("skips the scenes a previous attempt already committed", () => {
    const p = planResume(scenes, ["s1", "s2", "s3"]);
    expect(p.toBuild.map((s) => s.id)).toEqual(["s4", "s5"]);
    expect(p.keepSceneIds).toEqual(["s1", "s2", "s3"]);
    expect(p.skipped).toBe(3);
  });

  it("has nothing left to do when every scene is checkpointed", () => {
    const p = planResume(scenes, ["s1", "s2", "s3", "s4", "s5"]);
    expect(p.toBuild).toEqual([]);
    expect(p.keepSceneIds).toHaveLength(5);
  });

  it("ignores checkpointed ids that no longer exist", () => {
    const p = planResume(scenes, ["old-a", "old-b"]);
    expect(p.toBuild).toHaveLength(5);
    expect(p.keepSceneIds).toEqual([]);
    expect(p.skipped).toBe(0);
  });

  it("keeps scene order and does not assume the checkpoint is a prefix", () => {
    const p = planResume(scenes, ["s3", "s1"]);
    expect(p.toBuild.map((s) => s.id)).toEqual(["s2", "s4", "s5"]);
    expect(p.keepSceneIds).toEqual(["s1", "s3"]);
  });
});
