import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { addTaskJob } from "@/lib/task/queues";
import { publishTaskEvent } from "@/lib/task/events";
import { classifyError, getQueueForTaskType, TaskError, type TaskType } from "@/lib/task/types";
import { settleTaskFreeze, rollbackTaskFreeze } from "@/lib/billing/ledger";
import { advanceAfterTask } from "@/lib/batch/advance";
import type { Task } from "@prisma/client";

export interface HandlerContext {
  task: Task;
  reportProgress: (pct: number, data?: unknown) => void;
}

export type TaskHandler = (ctx: HandlerContext) => Promise<unknown>;

const HEARTBEAT_MS = 10_000;

export async function withTaskLifecycle(taskId: string, handler: TaskHandler): Promise<void> {
  const claimed = await prisma.task.updateMany({
    where: { id: taskId, status: "queued" },
    data: { status: "processing", attempt: { increment: 1 }, startedAt: new Date(), heartbeatAt: new Date() },
  });
  if (claimed.count === 0) return;

  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  const evBase = { taskId, taskType: task.type, targetType: task.targetType, targetId: task.targetId };

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
      ...evBase,
      eventType: "PROGRESS",
      progress: clamped,
      data,
    });
  };

  publishTaskEvent(task.projectId, { ...evBase, eventType: "PROCESSING" });

  let runtimeTimer: ReturnType<typeof setTimeout> | undefined;
  const runtimeCap = new Promise<never>((_, reject) => {
    runtimeTimer = setTimeout(
      () => reject(new TaskError("TASK_TIMEOUT", `task exceeded TASK_MAX_RUNTIME_MS (${env.TASK_MAX_RUNTIME_MS}ms)`, true)),
      env.TASK_MAX_RUNTIME_MS,
    );
  });

  try {
    const result = await Promise.race([handler({ task, reportProgress }), runtimeCap]);
    const won = await prisma.task.updateMany({
      where: { id: taskId, status: "processing" },
      data: { status: "completed", progress: 100, result: (result ?? null) as object, finishedAt: new Date(), errorCode: null, errorMessage: null },
    });
    if (won.count === 0) return;
    await settleTaskFreeze(taskId);
    publishTaskEvent(task.projectId, { ...evBase, eventType: "COMPLETED", progress: 100 });
    advanceAfterTask(task.episodeId);
  } catch (err) {
    const { code, message, retryable } = classifyError(err);

    if (retryable && task.attempt < task.maxAttempts) {
      const delayMs = Math.min(2_000 * 2 ** (task.attempt - 1), 30_000);
      const requeued = await prisma.task.updateMany({
        where: { id: taskId, status: "processing" },
        data: { status: "queued", heartbeatAt: null, errorCode: code, errorMessage: message.slice(0, 1000) },
      });
      if (requeued.count === 0) return;
      publishTaskEvent(task.projectId, { ...evBase, eventType: "RETRYING", errorCode: code });
      await addTaskJob(getQueueForTaskType(task.type as TaskType), taskId, delayMs);
      return;
    }

    const failed = await prisma.task.updateMany({
      where: { id: taskId, status: "processing" },
      data: { status: "failed", errorCode: code, errorMessage: message.slice(0, 1000), finishedAt: new Date() },
    });
    if (failed.count === 0) return;
    await rollbackTaskFreeze(taskId);
    publishTaskEvent(task.projectId, { ...evBase, eventType: "FAILED", errorCode: code });
  } finally {
    clearInterval(heartbeat);
    if (runtimeTimer) clearTimeout(runtimeTimer);
  }
}
