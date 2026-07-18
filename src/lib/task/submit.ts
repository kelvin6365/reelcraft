import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { addTaskJob } from "@/lib/task/queues";
import { publishTaskEvent } from "@/lib/task/events";
import { getQueueForTaskType, type TaskType } from "@/lib/task/types";

export interface SubmitTaskInput {
  userId: string;
  type: TaskType;
  targetType?: string;
  targetId?: string;
  projectId?: string;
  episodeId?: string;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
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
  const dedupeKey = buildDedupeKey(input);

  // Dedupe: an active task with the same key wins (idempotent submission).
  const existing = await prisma.task.findUnique({ where: { dedupeKey } });
  if (existing && (existing.status === "queued" || existing.status === "processing")) {
    return { taskId: existing.id, deduped: true };
  }
  if (existing) {
    // terminal task occupies the key — free it so a fresh run can happen
    await prisma.task.update({
      where: { id: existing.id },
      data: { dedupeKey: `${dedupeKey}:done:${existing.id}` },
    });
  }

  const task = await prisma.task.create({
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

  audit(input.userId, "task.submit", {
    targetType: "task",
    targetId: task.id,
    source: "system",
    metadata: { type: input.type, targetId: input.targetId },
  });
  publishTaskEvent(input.projectId ?? null, { taskId: task.id, taskType: input.type, eventType: "CREATED" });

  try {
    await addTaskJob(getQueueForTaskType(input.type), task.id);
  } catch (err) {
    await prisma.task.update({
      where: { id: task.id },
      data: { status: "failed", errorCode: "ENQUEUE_FAILED", errorMessage: String(err), finishedAt: new Date() },
    });
    publishTaskEvent(input.projectId ?? null, {
      taskId: task.id,
      taskType: input.type,
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
  publishTaskEvent(task.projectId, { taskId: task.id, taskType: task.type, eventType: "RETRYING" });
}
