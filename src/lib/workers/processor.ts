// Shared per-task processing logic — the ONE code path both the BullMQ worker
// entry (src/lib/workers/index.ts, full mode) and the local in-process poller
// (src/lib/task/local-queue.ts, DEPLOY_MODE=local) dispatch through. Extracted
// from workers/index.ts so local mode never forks the gate/lifecycle logic
// (docs/plans/2026-07-25-local-quickstart-design.md §3).
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { withTaskLifecycle } from "@/lib/workers/lifecycle";
import { getHandler } from "@/lib/workers/registry";
import { addTaskJob } from "@/lib/task/queues";
import { acquireSlot, releaseSlot, type GateScope } from "@/lib/quota/gate";
import type { QueueName, TaskType } from "@/lib/task/types";
import "@/lib/workers/handlers"; // side-effect: registers pipeline handlers

// Which queues gate per-user concurrency, and the env-driven slot limit for each.
// text/voice are cheap → ungated. Slots self-expire after 15min (crashed-worker safety).
const GATE_TTL_SEC = 15 * 60;
export const QUEUE_GATE: Partial<Record<QueueName, { scope: GateScope; limit: number }>> = {
  "rc-image": { scope: "image", limit: env.QUOTA_USER_CONCURRENT_IMAGE },
  "rc-video": { scope: "video", limit: env.QUOTA_USER_CONCURRENT_VIDEO },
};

export const REQUEUE_DELAY_MS = 5_000;

export async function processTask(queueName: QueueName, taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { type: true, userId: true } });
  if (!task) return; // task row gone — nothing to do

  // Gated queues: take a per-user slot before doing any work. If the user is at
  // their concurrency cap, requeue with a delay WITHOUT claiming the task (it stays
  // 'queued'), so another user's job isn't starved behind this one.
  const gate = QUEUE_GATE[queueName];
  if (gate) {
    const token = await acquireSlot(task.userId, gate.scope, gate.limit, GATE_TTL_SEC);
    if (!token) {
      await addTaskJob(queueName, taskId, REQUEUE_DELAY_MS);
      return;
    }
    try {
      await withTaskLifecycle(taskId, getHandler(task.type as TaskType));
    } finally {
      await releaseSlot(task.userId, gate.scope, token);
    }
    return;
  }

  await withTaskLifecycle(taskId, getHandler(task.type as TaskType));
}
