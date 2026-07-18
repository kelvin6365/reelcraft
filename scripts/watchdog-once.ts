// Runs a single watchdog pass then exits (used by smoke-task; handy for cron).
import { prisma } from "../src/lib/db";
import { env } from "../src/lib/env";
import { addTaskJob, isJobAlive } from "../src/lib/task/queues";
import { publishTaskEvent } from "../src/lib/task/events";
import { getQueueForTaskType, type TaskType } from "../src/lib/task/types";

async function main() {
  // orphaned queued
  const queued = await prisma.task.findMany({ where: { status: "queued" }, take: 200 });
  for (const t of queued) {
    const queue = getQueueForTaskType(t.type as TaskType);
    if (await isJobAlive(queue, t.id)) continue;
    console.log(`[watchdog-once] re-enqueue orphaned ${t.id}`);
    await addTaskJob(queue, t.id, 1);
  }
  // zombies
  const cutoff = new Date(Date.now() - env.TASK_HEARTBEAT_TIMEOUT_MS);
  const zombies = await prisma.task.findMany({
    where: { status: "processing", OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null }] },
    take: 200,
  });
  for (const t of zombies) {
    if (t.attempt >= t.maxAttempts) {
      await prisma.task.update({
        where: { id: t.id },
        data: { status: "failed", errorCode: "WATCHDOG_TIMEOUT", errorMessage: "heartbeat lost", finishedAt: new Date() },
      });
      publishTaskEvent(t.projectId, { taskId: t.id, taskType: t.type, eventType: "FAILED", errorCode: "WATCHDOG_TIMEOUT" });
    } else {
      await prisma.task.update({ where: { id: t.id }, data: { status: "queued", heartbeatAt: null, startedAt: null } });
      await addTaskJob(getQueueForTaskType(t.type as TaskType), t.id, 1);
      console.log(`[watchdog-once] requeued zombie ${t.id}`);
    }
  }
  await prisma.$disconnect();
  process.exit(0); // BullMQ/Redis connections would otherwise keep the loop alive
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
