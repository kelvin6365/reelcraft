import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { addTaskJob } from "@/lib/task/queues";
import { publishTaskEvent } from "@/lib/task/events";
import { classifyError, getQueueForTaskType, TaskError, type TaskType } from "@/lib/task/types";
import { settleTaskFreeze, rollbackTaskFreeze } from "@/lib/billing/ledger";
import { cancelPendingForTask } from "@/lib/ai/request-journal";
import { advanceAfterTask } from "@/lib/batch/advance";
import type { Task } from "@prisma/client";

export interface HandlerContext {
  task: Task;
  reportProgress: (pct: number, data?: unknown) => void;
}

export type TaskHandler = (ctx: HandlerContext) => Promise<unknown>;

const HEARTBEAT_MS = 10_000;

// 呢個 process 而家 claim 緊嘅 task。關機（SIGTERM／tsx watch reload）時由
// releaseActiveTasks() 即刻打返 queued 並重新入 job —— 唔使等 heartbeat timeout
// （90s）+ watchdog tick（30s）先復原。配合 provider request journal，重入之後
// 係續 poll 同一條 provider request，唔會重新 submit。
const activeTaskIds = new Set<string>();

export function getActiveTaskIds(): string[] {
  return [...activeTaskIds];
}

// 關機時交還手上嘅 task：由 processing 打返 queued 再入返 job。
// 刻意唔減返 attempt —— 一個一開機就整死 worker 嘅毒藥 task 必須燒得晒
// maxAttempts 然後 fail，唔可以無限重入。
export async function releaseActiveTasks(): Promise<number> {
  const ids = getActiveTaskIds();
  let released = 0;
  for (const taskId of ids) {
    try {
      const task = await prisma.task.findUnique({ where: { id: taskId }, select: { type: true, projectId: true } });
      if (!task) continue;
      const back = await prisma.task.updateMany({
        where: { id: taskId, status: "processing" },
        data: { status: "queued", heartbeatAt: null, startedAt: null, errorCode: "WORKER_SHUTDOWN" },
      });
      if (back.count === 0) continue;
      await addTaskJob(getQueueForTaskType(task.type as TaskType), taskId, 1);
      publishTaskEvent(task.projectId, {
        taskId,
        taskType: task.type,
        eventType: "RETRYING",
        errorCode: "WORKER_SHUTDOWN",
      });
      released++;
    } catch (err) {
      console.error("[worker] releaseActiveTasks failed", { taskId, err: String(err) });
    }
  }
  return released;
}

export async function withTaskLifecycle(taskId: string, handler: TaskHandler): Promise<void> {
  const claimed = await prisma.task.updateMany({
    where: { id: taskId, status: "queued" },
    data: { status: "processing", attempt: { increment: 1 }, startedAt: new Date(), heartbeatAt: new Date() },
  });
  if (claimed.count === 0) return;
  activeTaskIds.add(taskId);

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
    // 終局失敗：仲喺途中嘅 provider request 冇人會再收貨，叫停佢。
    // （retryable 分支刻意唔叫 —— 嗰啲正正係要留返嚟續 poll 嘅。）
    await cancelPendingForTask(taskId);
    publishTaskEvent(task.projectId, { ...evBase, eventType: "FAILED", errorCode: code });
  } finally {
    activeTaskIds.delete(taskId);
    clearInterval(heartbeat);
    if (runtimeTimer) clearTimeout(runtimeTimer);
  }
}
