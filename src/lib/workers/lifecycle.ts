import { prisma } from "@/lib/db";
import { addTaskJob } from "@/lib/task/queues";
import { publishTaskEvent } from "@/lib/task/events";
import { classifyError, getQueueForTaskType, type TaskType } from "@/lib/task/types";
import { settleTaskFreeze, rollbackTaskFreeze } from "@/lib/billing/ledger";
import type { Task } from "@prisma/client";

export interface HandlerContext {
  task: Task;
  reportProgress: (pct: number, data?: unknown) => void;
}

export type TaskHandler = (ctx: HandlerContext) => Promise<unknown>;

const HEARTBEAT_MS = 10_000;

// The single execution wrapper for every worker job (docs/tech/02-task-system.md).
export async function withTaskLifecycle(taskId: string, handler: TaskHandler): Promise<void> {
  // Atomic claim — guards against watchdog re-enqueue races and double delivery.
  const claimed = await prisma.task.updateMany({
    where: { id: taskId, status: "queued" },
    data: { status: "processing", attempt: { increment: 1 }, startedAt: new Date(), heartbeatAt: new Date() },
  });
  if (claimed.count === 0) return; // already terminal/claimed elsewhere — skip silently

  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });

  const heartbeat = setInterval(() => {
    void prisma.task
      .updateMany({ where: { id: taskId, status: "processing" }, data: { heartbeatAt: new Date() } })
      .catch(() => {});
  }, HEARTBEAT_MS);

  const reportProgress = (pct: number, data?: unknown) => {
    const clamped = Math.max(0, Math.min(99, Math.round(pct)));
    void prisma.task
      .updateMany({ where: { id: taskId, status: "processing" }, data: { progress: clamped } })
      .catch(() => {});
    publishTaskEvent(task.projectId, {
      taskId,
      taskType: task.type,
      eventType: "PROGRESS",
      progress: clamped,
      data,
    });
  };

  publishTaskEvent(task.projectId, { taskId, taskType: task.type, eventType: "PROCESSING" });

  try {
    const result = await handler({ task, reportProgress });
    // Status-guarded terminal write: if the watchdog requeued this row mid-flight
    // (stale heartbeat) and another worker already took over, count===0 → we do
    // NOT overwrite its state, settle, or emit — this worker's result is discarded.
    const won = await prisma.task.updateMany({
      where: { id: taskId, status: "processing" },
      data: { status: "completed", progress: 100, result: (result ?? null) as object, finishedAt: new Date() },
    });
    if (won.count === 0) return;
    await settleTaskFreeze(taskId); // ENFORCE: charge actual (from ai_call_logs), refund the rest
    publishTaskEvent(task.projectId, { taskId, taskType: task.type, eventType: "COMPLETED", progress: 100 });
  } catch (err) {
    const { code, message, retryable } = classifyError(err);

    if (retryable && task.attempt < task.maxAttempts) {
      // App-layer retry: reset to queued and re-enqueue with exponential backoff.
      const delayMs = Math.min(2_000 * 2 ** (task.attempt - 1), 30_000);
      const requeued = await prisma.task.updateMany({
        where: { id: taskId, status: "processing" },
        data: { status: "queued", heartbeatAt: null, errorCode: code, errorMessage: message.slice(0, 1000) },
      });
      if (requeued.count === 0) return; // another worker owns it now
      publishTaskEvent(task.projectId, { taskId, taskType: task.type, eventType: "RETRYING", errorCode: code });
      await addTaskJob(getQueueForTaskType(task.type as TaskType), taskId, delayMs);
      return;
    }

    const failed = await prisma.task.updateMany({
      where: { id: taskId, status: "processing" },
      data: { status: "failed", errorCode: code, errorMessage: message.slice(0, 1000), finishedAt: new Date() },
    });
    if (failed.count === 0) return;
    await rollbackTaskFreeze(taskId); // ENFORCE: terminal failure — release the whole reservation
    publishTaskEvent(task.projectId, { taskId, taskType: task.type, eventType: "FAILED", errorCode: code });
  } finally {
    clearInterval(heartbeat);
  }
}
