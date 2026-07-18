import { Queue } from "bullmq";
import { queueRedis } from "@/lib/redis";
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

export async function addTaskJob(queueName: QueueName, taskId: string, delayMs = 0): Promise<void> {
  // jobId = taskId → DB task id and BullMQ job id are the same (reconciliation basis).
  // Re-enqueues get a unique suffix (BullMQ won't re-add a finished jobId; no colons allowed).
  await getQueue(queueName).add(
    "task",
    { taskId },
    { jobId: delayMs > 0 ? `${taskId}-r${Date.now()}` : taskId, delay: delayMs },
  );
}

export async function isJobAlive(queueName: QueueName, taskId: string): Promise<boolean> {
  const job = await getQueue(queueName).getJob(taskId);
  if (!job) return false;
  const state = await job.getState();
  return state === "waiting" || state === "active" || state === "delayed" || state === "prioritized";
}
