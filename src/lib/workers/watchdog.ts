// Watchdog — run with: npm run watchdog. Two duties every WATCHDOG_INTERVAL_MS:
// 1) orphan recovery: queued tasks whose BullMQ job vanished → re-enqueue
// 2) zombie cleanup: processing tasks with stale heartbeat → requeue or fail
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { addTaskJob } from "@/lib/task/queues";
import { publishTaskEvent } from "@/lib/task/events";
import { getQueueForTaskType, type TaskType } from "@/lib/task/types";
import { recoverOrphanedQueued } from "@/lib/task/recover";
import { reapLeakedSlots } from "@/lib/quota/reap-leaked";

async function cleanupZombies(): Promise<void> {
  const cutoff = new Date(Date.now() - env.TASK_HEARTBEAT_TIMEOUT_MS);
  const zombies = await prisma.task.findMany({
    where: { status: "processing", OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null }] },
    take: 200,
  });
  // A zombie's worker died mid-job, so it also leaked its gate slot. Requeuing
  // the task isn't enough — the leaked slot would bounce it in the gate-requeue
  // loop until the 15-min TTL. Free those slots for the affected users once all
  // their zombies are requeued.
  const affectedUsers = new Set<string>();
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
      affectedUsers.add(t.userId);
      console.log(`[watchdog] requeued zombie ${t.id} (${t.type}, attempt ${t.attempt}/${t.maxAttempts})`);
    }
  }
  // Now that the zombies are back to queued (no longer counted as processing),
  // reapLeakedSlots frees the dead worker's slots for any user with zero
  // remaining processing tasks in the scope.
  for (const userId of affectedUsers) {
    const { image, video } = await reapLeakedSlots(userId);
    if (image + video > 0) console.log(`[watchdog] reaped ${image + video} leaked slot(s) for ${userId}`);
  }
}

async function tick(): Promise<void> {
  try {
    const { recovered } = await recoverOrphanedQueued();
    if (recovered > 0) console.log(`[watchdog] re-enqueued ${recovered} orphaned queued task(s)`);
    await cleanupZombies();
  } catch (err) {
    console.error("[watchdog] tick error", err);
  }
}

console.log(`[watchdog] started (interval ${env.WATCHDOG_INTERVAL_MS}ms, heartbeat timeout ${env.TASK_HEARTBEAT_TIMEOUT_MS}ms)`);
void tick();
setInterval(() => void tick(), env.WATCHDOG_INTERVAL_MS);
