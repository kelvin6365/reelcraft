// Watchdog — run with: npm run watchdog. Two duties every WATCHDOG_INTERVAL_MS:
// 1) orphan recovery: queued tasks whose BullMQ job vanished → re-enqueue
// 2) zombie cleanup: processing tasks with stale heartbeat → requeue or fail
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { addTaskJob, isJobAlive } from "@/lib/task/queues";
import { publishTaskEvent } from "@/lib/task/events";
import { getQueueForTaskType, type TaskType } from "@/lib/task/types";

async function recoverOrphanedQueued(): Promise<void> {
  const tasks = await prisma.task.findMany({ where: { status: "queued" }, take: 200 });
  for (const t of tasks) {
    const queue = getQueueForTaskType(t.type as TaskType);
    if (await isJobAlive(queue, t.id)) continue;
    console.log(`[watchdog] re-enqueue orphaned queued task ${t.id} (${t.type})`);
    await addTaskJob(queue, t.id, 1);
  }
}

async function cleanupZombies(): Promise<void> {
  const cutoff = new Date(Date.now() - env.TASK_HEARTBEAT_TIMEOUT_MS);
  const zombies = await prisma.task.findMany({
    where: { status: "processing", OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null }] },
    take: 200,
  });
  for (const t of zombies) {
    if (t.attempt >= t.maxAttempts) {
      await prisma.task.update({
        where: { id: t.id },
        data: { status: "failed", errorCode: "WATCHDOG_TIMEOUT", errorMessage: "heartbeat lost, max attempts reached", finishedAt: new Date() },
      });
      publishTaskEvent(t.projectId, { taskId: t.id, taskType: t.type, eventType: "FAILED", errorCode: "WATCHDOG_TIMEOUT" });
      console.log(`[watchdog] failed zombie ${t.id} (${t.type})`);
    } else {
      await prisma.task.update({
        where: { id: t.id },
        data: { status: "queued", heartbeatAt: null, startedAt: null },
      });
      publishTaskEvent(t.projectId, { taskId: t.id, taskType: t.type, eventType: "RETRYING", errorCode: "WATCHDOG_REQUEUE" });
      await addTaskJob(getQueueForTaskType(t.type as TaskType), t.id, 1);
      console.log(`[watchdog] requeued zombie ${t.id} (${t.type}, attempt ${t.attempt}/${t.maxAttempts})`);
    }
  }
}

async function tick(): Promise<void> {
  try {
    await recoverOrphanedQueued();
    await cleanupZombies();
  } catch (err) {
    console.error("[watchdog] tick error", err);
  }
}

console.log(`[watchdog] started (interval ${env.WATCHDOG_INTERVAL_MS}ms, heartbeat timeout ${env.TASK_HEARTBEAT_TIMEOUT_MS}ms)`);
void tick();
setInterval(() => void tick(), env.WATCHDOG_INTERVAL_MS);
