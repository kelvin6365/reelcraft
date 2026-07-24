// Bulk retry — powers the 「全部重試」 buttons in FailureDrawer and
// ProjectFailurePanel. Reuses the exact same retryTask() as the single-task
// retry route (src/app/api/tasks/[id]/retry/route.ts); ownership + terminal
// filtering happen here so a client can just throw a list of ids at it.
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { fail, ok } from "@/lib/api/errors";
import { retryTask } from "@/lib/task/submit";
import { humanizeTaskError } from "@/lib/task/error-copy";

interface BulkRetryResult {
  id: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

export const POST = withAuth(
  async ({ userId, req }) => {
    const body = (await req.json().catch(() => ({}))) as Partial<{ taskIds: unknown }>;
    const taskIds = Array.isArray(body.taskIds)
      ? body.taskIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    if (taskIds.length === 0) return fail("BAD_REQUEST", 400, "taskIds 不可為空");
    if (taskIds.length > 100) return fail("BAD_REQUEST", 400, "一次最多重試 100 個任務");

    // Ownership scoped in one query; anything not found here silently belongs
    // to someone else (or doesn't exist) and is reported as such, never retried.
    const tasks = await prisma.task.findMany({
      where: { id: { in: taskIds }, userId },
      select: { id: true, status: true, errorCode: true, errorMessage: true },
    });
    const byId = new Map(tasks.map((t) => [t.id, t]));

    const results: BulkRetryResult[] = [];
    for (const id of taskIds) {
      const task = byId.get(id);
      if (!task) {
        results.push({ id, ok: false, error: "找不到任務" });
        continue;
      }
      if (task.status !== "failed" && task.status !== "canceled") {
        results.push({ id, ok: false, skipped: true, error: "任務並非終局狀態" });
        continue;
      }
      // Truly-terminal errors (nothing the user can do) are skipped. But
      // recoverable ones (PROVIDER_KEY_MISSING, wrong model) ARE retried — the
      // user has presumably just fixed the config; otherwise they'd stay stuck
      // in the drawer forever.
      const humanized = humanizeTaskError(task.errorCode, task.errorMessage);
      if (humanized.terminal && !humanized.recoverable) {
        results.push({ id, ok: false, skipped: true, error: humanized.message });
        continue;
      }
      try {
        await retryTask(userId, id);
        results.push({ id, ok: true });
      } catch (err) {
        results.push({ id, ok: false, error: String(err instanceof Error ? err.message : err) });
      }
    }

    const retried = results.filter((r) => r.ok).length;
    return ok({ retried, total: taskIds.length, results });
  },
  { auditAction: "task.retry_bulk" },
);
