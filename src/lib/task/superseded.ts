// A failed task row is permanent, so "5 個失敗" used to mean "5 things failed at
// some point in this episode's history" — not "5 things are broken right now".
// Fix the model, regenerate successfully, and the rail still showed red forever;
// with terminal errors there is not even a retry button to clear it.
//
// The rule is uniform and needs no per-task-type knowledge: a failure is
// superseded once a LATER task of the same (type, targetId) completed. That
// covers per-item work (IMAGE_SHOT on shot X succeeded after failing) and
// episode-level work (a second STORYBOARD_RUN completed) with one comparison.
//
// Pure so it can be unit-tested; used by the episode snapshot (counts on the
// rail) and the failed-tasks route (the drawer list) so the two never disagree.

export interface TaskTiming {
  type: string;
  targetId: string;
  queuedAt: Date | string;
  finishedAt: Date | string | null;
}

const key = (t: { type: string; targetId: string }) => `${t.type}:${t.targetId}`;
const ms = (v: Date | string) => (v instanceof Date ? v.getTime() : new Date(v).getTime());
// finishedAt is null for a row the watchdog failed without a worker completing
// it; queuedAt always exists and orders correctly against later completions.
const at = (t: TaskTiming) => ms(t.finishedAt ?? t.queuedAt);

export function buildLatestSuccess(completed: TaskTiming[]): Map<string, number> {
  const latest = new Map<string, number>();
  for (const t of completed) {
    const k = key(t);
    const time = at(t);
    const prev = latest.get(k);
    if (prev === undefined || time > prev) latest.set(k, time);
  }
  return latest;
}

export function filterUnresolvedFailures<T extends TaskTiming>(failed: T[], completed: TaskTiming[]): T[] {
  const latest = buildLatestSuccess(completed);
  return failed.filter((f) => {
    const success = latest.get(key(f));
    return success === undefined || success <= at(f);
  });
}
