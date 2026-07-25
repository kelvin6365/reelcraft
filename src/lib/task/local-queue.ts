// In-process substitute for the BullMQ+Redis queue driver, used when
// DEPLOY_MODE=local (docs/plans/2026-07-25-local-quickstart-design.md §3).
// A single poll loop claims `queued` Task rows and dispatches them through
// processTask() — the SAME code path the BullMQ workers use (src/lib/workers/
// processor.ts) — so nothing here forks worker logic.
import { prisma } from "@/lib/db";
import { processTask } from "@/lib/workers/processor";
import { getQueueForTaskType, type TaskType } from "@/lib/task/types";

const POLL_INTERVAL_MS = 1_000;
const BATCH_LIMIT = 10;
const MAX_CONCURRENCY = 4;

// taskId -> earliest timestamp (ms) it may be picked up again. Populated by
// addTaskJob() (src/lib/task/queues.ts) for retry backoff / gate requeues —
// the local-mode stand-in for BullMQ's delayed jobs. Single process, so a
// plain Map is enough.
export const localDelays = new Map<string, number>();

// Tasks currently being processed by this poller — guards against re-selecting
// a task on the next tick before withTaskLifecycle's DB claim (status ->
// 'processing') has landed.
const claimedIds = new Set<string>();

let started = false;
let inFlight = 0;

function pruneExpiredDelays(): void {
  const now = Date.now();
  for (const [id, notBefore] of localDelays) {
    if (notBefore <= now) localDelays.delete(id);
  }
}

async function pollOnce(): Promise<void> {
  if (inFlight >= MAX_CONCURRENCY) return;
  pruneExpiredDelays();

  const candidates = await prisma.task.findMany({
    where: { status: "queued" },
    orderBy: { queuedAt: "asc" },
    take: BATCH_LIMIT,
    select: { id: true, type: true },
  });

  for (const task of candidates) {
    if (inFlight >= MAX_CONCURRENCY) break;
    if (claimedIds.has(task.id)) continue;
    const notBefore = localDelays.get(task.id);
    if (notBefore !== undefined && notBefore > Date.now()) continue;

    claimedIds.add(task.id);
    inFlight++;
    const queue = getQueueForTaskType(task.type as TaskType);
    void processTask(queue, task.id)
      .catch((err) => console.error("[local-queue] processTask failed", { taskId: task.id, err: String(err) }))
      .finally(() => {
        inFlight--;
        claimedIds.delete(task.id);
      });
  }
}

/** Starts the poll loop. Idempotent — a second call is a no-op (module-level guard). */
export function startLocalWorker(): void {
  if (started) return;
  started = true;
  const timer = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
  timer.unref?.();
  console.log(`[local-queue] poller started (interval ${POLL_INTERVAL_MS}ms, max concurrency ${MAX_CONCURRENCY})`);
}

// Used by task/queues.ts's isJobAlive: true when the poller is running AND the
// task is still live from the driver's point of view — either claimed by this
// poller right now, or still 'queued'/'processing' in the DB (which the
// poller will pick up, or already has). Mirrors the BullMQ semantics
// ("waiting" | "active" | "delayed" | "prioritized" all count as alive).
export async function localJobAlive(taskId: string): Promise<boolean> {
  if (!started) return false;
  if (claimedIds.has(taskId)) return true;
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { status: true } });
  return task?.status === "queued" || task?.status === "processing";
}
