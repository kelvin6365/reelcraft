import { Queue } from "bullmq";
import { queueRedis } from "@/lib/redis";
import { isLocalMode } from "@/lib/env";
import { localDelays, localJobAlive } from "@/lib/task/local-queue";
import type { QueueName, TaskJobData } from "@/lib/task/types";

// attempts:1 — retries are decided by the app layer (withTaskLifecycle re-enqueues), not BullMQ.
const defaultJobOptions = {
  removeOnComplete: 500,
  removeOnFail: 500,
  attempts: 1,
} as const;

const g = globalThis as unknown as { __rcQueues?: Map<QueueName, Queue<TaskJobData>> };
const queues = (g.__rcQueues ??= new Map());

export function getQueue(name: QueueName): Queue<TaskJobData> {
  let q = queues.get(name);
  if (!q) {
    q = new Queue<TaskJobData>(name, { connection: queueRedis, defaultJobOptions });
    queues.set(name, q);
  }
  return q;
}

// A task's BullMQ job id ≠ its taskId once it has been re-enqueued (see below),
// so we record the CURRENT job id in Redis. isJobAlive reads it to look up the
// right job; without this it checked the bare taskId, always missed the suffixed
// re-enqueue, and the watchdog/recover kept re-adding "orphaned" jobs that were
// actually alive — piling up thousands of delayed duplicates. Advisory + TTL'd:
// a stale entry just makes isJobAlive fall back to a re-enqueue, which is safe.
const jobMapKey = (taskId: string) => `rc:jobmap:${taskId}`;
const JOBMAP_TTL_SEC = 3600;

export async function addTaskJob(queueName: QueueName, taskId: string, delayMs = 0): Promise<void> {
  if (isLocalMode()) {
    // The task row is already `queued` (submitTask/retryTask/watchdog set it
    // before calling addTaskJob) — src/lib/task/local-queue.ts's DB poller
    // picks it up on its own. A positive delay just needs bookkeeping so the
    // poller skips it until then (retry backoff / gate requeue).
    if (delayMs > 0) localDelays.set(taskId, Date.now() + delayMs);
    else localDelays.delete(taskId);
    return;
  }

  // Initial enqueue uses jobId = taskId. Re-enqueues (delay > 0) get a unique
  // suffix because BullMQ won't re-add a jobId that already completed/failed.
  const jobId = delayMs > 0 ? `${taskId}-r${Date.now()}` : taskId;
  await getQueue(queueName).add("task", { taskId }, { jobId, delay: delayMs });
  await queueRedis.set(jobMapKey(taskId), jobId, "EX", JOBMAP_TTL_SEC);
}

export async function isJobAlive(queueName: QueueName, taskId: string): Promise<boolean> {
  if (isLocalMode()) return localJobAlive(taskId);

  const jobId = (await queueRedis.get(jobMapKey(taskId))) ?? taskId; // fallback: legacy jobs keyed by taskId
  const job = await getQueue(queueName).getJob(jobId);
  if (!job) return false;
  const state = await job.getState();
  return state === "waiting" || state === "active" || state === "delayed" || state === "prioritized";
}
