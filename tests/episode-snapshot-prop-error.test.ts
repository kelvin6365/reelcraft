import { describe, expect, it } from "vitest";
import { pickPropLastError, type PropTerminalTaskRow } from "@/lib/api/episode-snapshot";

const t = (
  type: string,
  targetId: string,
  status: "failed" | "completed",
  finished: string | null,
  errorCode: string | null = null,
  queued = "2026-07-28T00:00:00Z",
): PropTerminalTaskRow => ({
  type,
  targetId,
  status,
  errorCode,
  errorMessage: errorCode ? `${errorCode} happened` : null,
  queuedAt: queued,
  finishedAt: finished,
});

describe("pickPropLastError (道具 status transparency design)", () => {
  it("returns a humanized-ready error for a prop with an unresolved failure", () => {
    const result = pickPropLastError([t("IMAGE_PROP", "p1", "failed", "2026-07-28T10:00:00Z", "HTTP_403")]);
    expect(result.p1).toMatchObject({ status: "failed", errorCode: "HTTP_403" });
  });

  it("is null (absent) once the latest terminal task for that prop is completed", () => {
    const result = pickPropLastError([
      t("IMAGE_PROP", "p1", "failed", "2026-07-28T09:00:00Z", "HTTP_403"),
      t("IMAGE_PROP", "p1", "completed", "2026-07-28T10:00:00Z"),
    ]);
    expect(result.p1).toBeUndefined();
  });

  it("keeps a failure that happened AFTER the last success", () => {
    const result = pickPropLastError([
      t("IMAGE_PROP", "p1", "completed", "2026-07-28T09:00:00Z"),
      t("IMAGE_PROP", "p1", "failed", "2026-07-28T10:00:00Z", "WATCHDOG_TIMEOUT"),
    ]);
    expect(result.p1?.errorCode).toBe("WATCHDOG_TIMEOUT");
  });

  it("does not let a VIDEO_PROP success clear an unresolved IMAGE_PROP failure (different type)", () => {
    const result = pickPropLastError([
      t("IMAGE_PROP", "p1", "failed", "2026-07-28T09:00:00Z", "HTTP_403"),
      t("VIDEO_PROP", "p1", "completed", "2026-07-28T10:00:00Z"),
    ]);
    expect(result.p1?.errorCode).toBe("HTTP_403");
  });

  it("does not let another prop's success clear this prop's failure", () => {
    const result = pickPropLastError([
      t("IMAGE_PROP", "p1", "failed", "2026-07-28T09:00:00Z", "HTTP_403"),
      t("IMAGE_PROP", "p2", "completed", "2026-07-28T10:00:00Z"),
    ]);
    expect(result.p1?.errorCode).toBe("HTTP_403");
    expect(result.p2).toBeUndefined();
  });

  it("picks the more recent of two simultaneously-unresolved failures (IMAGE_PROP + VIDEO_PROP) on the same prop", () => {
    const result = pickPropLastError([
      t("IMAGE_PROP", "p1", "failed", "2026-07-28T09:00:00Z", "HTTP_403"),
      t("VIDEO_PROP", "p1", "failed", "2026-07-28T11:00:00Z", "WATCHDOG_TIMEOUT"),
    ]);
    expect(result.p1?.errorCode).toBe("WATCHDOG_TIMEOUT");
  });
});
