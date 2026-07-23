import { describe, expect, it } from "vitest";
import { filterUnresolvedFailures } from "@/lib/task/superseded";

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
