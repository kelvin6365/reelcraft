import { describe, expect, it } from "vitest";
import { activeFailures, filterUnresolvedFailures, latestFailurePerTarget } from "@/lib/task/superseded";

const t = (type: string, targetId: string, finished: string | null, queued = "2026-07-22T00:00:00Z") => ({
  type,
  targetId,
  queuedAt: queued,
  finishedAt: finished,
});

describe("filterUnresolvedFailures", () => {
  it("keeps a failure nothing has fixed", () => {
    const failed = [t("IMAGE_SHOT", "s1", "2026-07-22T10:00:00Z")];
    expect(filterUnresolvedFailures(failed, [])).toHaveLength(1);
  });

  // The whole point: fix the model, regenerate, and the red mark retires itself.
  it("retires a failure once the same target later succeeded", () => {
    const failed = [t("IMAGE_SHOT", "s1", "2026-07-22T10:00:00Z")];
    const completed = [t("IMAGE_SHOT", "s1", "2026-07-22T11:00:00Z")];
    expect(filterUnresolvedFailures(failed, completed)).toEqual([]);
  });

  it("keeps a failure that happened AFTER the last success", () => {
    const failed = [t("IMAGE_SHOT", "s1", "2026-07-22T12:00:00Z")];
    const completed = [t("IMAGE_SHOT", "s1", "2026-07-22T11:00:00Z")];
    expect(filterUnresolvedFailures(failed, completed)).toHaveLength(1);
  });

  it("does not let a success on one shot clear another shot's failure", () => {
    const failed = [t("IMAGE_SHOT", "s1", "2026-07-22T10:00:00Z")];
    const completed = [t("IMAGE_SHOT", "s2", "2026-07-22T11:00:00Z")];
    expect(filterUnresolvedFailures(failed, completed)).toHaveLength(1);
  });

  it("does not let a different task type clear a failure", () => {
    const failed = [t("IMAGE_SHOT", "s1", "2026-07-22T10:00:00Z")];
    const completed = [t("VIDEO_SHOT", "s1", "2026-07-22T11:00:00Z")];
    expect(filterUnresolvedFailures(failed, completed)).toHaveLength(1);
  });

  // Episode-level tasks carry an empty targetId; a later successful run of the
  // same type still retires the old failure.
  it("handles episode-level tasks with no targetId", () => {
    const failed = [t("STORYBOARD_RUN", "", "2026-07-22T10:00:00Z")];
    const completed = [t("STORYBOARD_RUN", "", "2026-07-22T11:00:00Z")];
    expect(filterUnresolvedFailures(failed, completed)).toEqual([]);
  });

  it("uses the latest success when a target succeeded more than once", () => {
    const failed = [t("IMAGE_SHOT", "s1", "2026-07-22T12:00:00Z")];
    const completed = [
      t("IMAGE_SHOT", "s1", "2026-07-22T11:00:00Z"),
      t("IMAGE_SHOT", "s1", "2026-07-22T13:00:00Z"),
    ];
    expect(filterUnresolvedFailures(failed, completed)).toEqual([]);
  });

  // A watchdog-failed row can have no finishedAt; queuedAt still orders it.
  it("falls back to queuedAt when a row never finished", () => {
    const failed = [t("IMAGE_SHOT", "s1", null, "2026-07-22T10:00:00Z")];
    expect(filterUnresolvedFailures(failed, [t("IMAGE_SHOT", "s1", "2026-07-22T11:00:00Z")])).toEqual([]);
    expect(filterUnresolvedFailures(failed, [t("IMAGE_SHOT", "s1", "2026-07-22T09:00:00Z")])).toHaveLength(1);
  });

  it("accepts Date objects as well as ISO strings", () => {
    const failed = [{ type: "IMAGE_SHOT", targetId: "s1", queuedAt: new Date(1000), finishedAt: new Date(2000) }];
    const completed = [{ type: "IMAGE_SHOT", targetId: "s1", queuedAt: new Date(3000), finishedAt: new Date(4000) }];
    expect(filterUnresolvedFailures(failed, completed)).toEqual([]);
  });
});

describe("latestFailurePerTarget + activeFailures", () => {
  it("collapses repeated failures on the same target to the latest", () => {
    const failed = [
      t("VIDEO_SHOT", "s1", "2026-07-24T10:00:00Z"),
      t("VIDEO_SHOT", "s1", "2026-07-24T11:00:00Z"),
      t("VIDEO_SHOT", "s1", "2026-07-24T12:00:00Z"),
    ];
    const out = latestFailurePerTarget(failed);
    expect(out).toHaveLength(1);
    expect(out[0].finishedAt).toBe("2026-07-24T12:00:00Z");
  });

  it("keeps distinct targets separate", () => {
    const failed = [t("VIDEO_SHOT", "s1", "2026-07-24T10:00:00Z"), t("VIDEO_SHOT", "s2", "2026-07-24T10:00:00Z")];
    expect(latestFailurePerTarget(failed)).toHaveLength(2);
  });

  it("distinguishes episode-level tasks (empty targetId) across episodes", () => {
    const failed = [
      { type: "STORYBOARD_RUN", targetId: "", episodeId: "epA", queuedAt: "2026-07-24T10:00:00Z", finishedAt: "2026-07-24T10:00:00Z" },
      { type: "STORYBOARD_RUN", targetId: "", episodeId: "epB", queuedAt: "2026-07-24T10:00:00Z", finishedAt: "2026-07-24T10:00:00Z" },
    ];
    expect(latestFailurePerTarget(failed)).toHaveLength(2); // not collapsed — different episodes
  });

  // The reported bug: 9 identical VIDEO_SHOT failures on 3 shots → show 3.
  it("activeFailures drops superseded then dedupes to one row per broken target", () => {
    const failed = [
      t("VIDEO_SHOT", "s1", "2026-07-24T10:00:00Z"),
      t("VIDEO_SHOT", "s1", "2026-07-24T11:00:00Z"),
      t("VIDEO_SHOT", "s2", "2026-07-24T10:00:00Z"),
      t("VIDEO_SHOT", "s3", "2026-07-24T10:00:00Z"),
    ];
    const completed = [t("VIDEO_SHOT", "s3", "2026-07-24T12:00:00Z")]; // s3 later succeeded
    const out = activeFailures(failed, completed);
    expect(out.map((x) => x.targetId).sort()).toEqual(["s1", "s2"]); // s3 gone, s1 collapsed
  });
})
