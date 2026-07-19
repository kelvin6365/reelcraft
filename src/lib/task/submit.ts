import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { addTaskJob } from "@/lib/task/queues";
import { publishTaskEvent } from "@/lib/task/events";
import { getQueueForTaskType, type TaskType } from "@/lib/task/types";
import { estimateTaskCost } from "@/lib/billing/quote";
import { freezeBalance, rollbackTaskFreeze, InsufficientBalanceError } from "@/lib/billing/ledger";
import { checkDailyQuota, dailyApiTypeForTask, refundDailyQuota } from "@/lib/quota/daily";

export interface SubmitTaskInput {
  userId: string;
  type: TaskType;
  targetType?: string;
  targetId?: string;
  projectId?: string;
  episodeId?: string;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
  // Manual "generate" buttons use payload {at: Date.now()} so a re-generate after
  // completion gets a fresh dedupeKey — but that also means every click while a
  // task is STILL RUNNING would enqueue (and pay for) another one. dedupeActive
  // collapses those: any active task on the same (type, targetId) wins, regardless
  // of payload. Tiny findFirst→create race window accepted (the dedupeKey unique
  // still catches byte-identical payloads).
  dedupeActive?: boolean;
}

function buildDedupeKey(input: SubmitTaskInput): string {
  const digest = createHash("sha1")
    .update(JSON.stringify([input.type, input.targetType ?? "", input.targetId ?? "", input.payload ?? {}]))
    .digest("hex");
  return `${input.type}:${input.targetId ?? "none"}:${digest.slice(0, 16)}`;
}

export interface SubmitResult {
  taskId: string;
  deduped: boolean;
}

export async function submitTask(input: SubmitTaskInput): Promise<SubmitResult> {
  if (input.dedupeActive && input.targetId) {
    const running = await prisma.task.findFirst({
      where: { userId: input.userId, type: input.type, targetId: input.targetId, status: { in: ["queued", "processing"] } },
      select: { id: true },
    });
    if (running) return { taskId: running.id, deduped: true };
  }

  const dedupeKey = buildDedupeKey(input);

  // Dedupe: an active task with the same key wins (idempotent submission).
  const existing = await prisma.task.findUnique({ where: { dedupeKey } });
  if (existing && (existing.status === "queued" || existing.status === "processing")) {
    return { taskId: existing.id, deduped: true };
  }

  // Daily quota — count one paid generation call and reject (throws QuotaExceededError)
  // when over. Runs after dedupe so an idempotent re-submit doesn't burn the budget,
  // and before task creation so the client gets a clean error and nothing is enqueued.
  const apiType = dailyApiTypeForTask(input.type);
  if (apiType) await checkDailyQuota(input.userId, apiType);

  if (existing) {
    // terminal task occupies the key — free it so a fresh run can happen
    await prisma.task.update({
      where: { id: existing.id },
      data: { dedupeKey: `${dedupeKey}:done:${existing.id}` },
    });
  }

  let task;
  try {
    task = await prisma.task.create({
      data: {
        id: newId(),
        userId: input.userId,
        projectId: input.projectId,
        episodeId: input.episodeId,
        type: input.type,
        targetType: input.targetType ?? "",
        targetId: input.targetId ?? "",
        dedupeKey,
        payload: (input.payload ?? {}) as object,
        maxAttempts: input.maxAttempts ?? 3,
      },
    });
  } catch (err) {
    // Race: a concurrent identical submit won the unique dedupeKey. Return theirs
    // rather than 500 — the point of dedupe is that only one runs.
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      const winner = await prisma.task.findUnique({ where: { dedupeKey } });
      if (winner) return { taskId: winner.id, deduped: true };
    }
    throw err;
  }

  audit(input.userId, "task.submit", {
    targetType: "task",
    targetId: task.id,
    source: "system",
    metadata: { type: input.type, targetId: input.targetId },
  });
  publishTaskEvent(input.projectId ?? null, { taskId: task.id, taskType: input.type, targetType: input.targetType, targetId: input.targetId, eventType: "CREATED" });

  // ENFORCE billing: reserve the worst-case cost before enqueue. The worker
  // settles this to actual on completion (or rolls it back on failure). An
  // uncovered balance fails the task terminally — nothing is enqueued.
  if (env.BILLING_MODE === "ENFORCE") {
    try {
      const quoteUsd = await estimateTaskCost(input.type, input.userId, input.payload ?? {}, input.projectId);
      await freezeBalance(input.userId, quoteUsd, task.id, task.id);
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        await refundDailyQuota(input.userId, input.type); // never ran → give the slot back
        await prisma.task.update({
          where: { id: task.id },
          data: { status: "failed", errorCode: "INSUFFICIENT_BALANCE", errorMessage: err.message, finishedAt: new Date() },
        });
        publishTaskEvent(input.projectId ?? null, {
          taskId: task.id,
          taskType: input.type,
          targetType: input.targetType,
          targetId: input.targetId,
          eventType: "FAILED",
          errorCode: "INSUFFICIENT_BALANCE",
        });
        return { taskId: task.id, deduped: false };
      }
      throw err;
    }
  }

  try {
    await addTaskJob(getQueueForTaskType(input.type), task.id);
  } catch (err) {
    await rollbackTaskFreeze(task.id); // release the reservation — the worker will never run this task
    await refundDailyQuota(input.userId, input.type); // never ran → give the slot back
    await prisma.task.update({
      where: { id: task.id },
      data: { status: "failed", errorCode: "ENQUEUE_FAILED", errorMessage: String(err), finishedAt: new Date() },
    });
    publishTaskEvent(input.projectId ?? null, {
      taskId: task.id,
      taskType: input.type,
      targetType: input.targetType,
      targetId: input.targetId,
      eventType: "FAILED",
      errorCode: "ENQUEUE_FAILED",
    });
    throw err;
  }

  return { taskId: task.id, deduped: false };
}

// One-click retry from the failure drawer: resets a terminal task and re-enqueues it.
export async function retryTask(userId: string, taskId: string): Promise<void> {
  const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
  if (!task) throw new Error("task not found");
  if (task.status !== "failed" && task.status !== "canceled") throw new Error("task is not terminal");

  await prisma.task.update({
    where: { id: task.id },
    data: { status: "queued", attempt: 0, progress: 0, errorCode: null, errorMessage: null, heartbeatAt: null, startedAt: null, finishedAt: null },
  });
  audit(userId, "task.retry", { targetType: "task", targetId: task.id });
  await addTaskJob(getQueueForTaskType(task.type as TaskType), task.id, 1);
  publishTaskEvent(task.projectId, { taskId: task.id, taskType: task.type, targetType: task.targetType, targetId: task.targetId, eventType: "RETRYING" });
}
