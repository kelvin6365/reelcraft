// Orphaned-queued recovery: a task marked `queued` in the DB whose BullMQ job
// has vanished will never run — the worker only consumes live jobs. This happens
// when the worker dies or (in dev) a tsx-watch reload drops the queue consumer,
// exactly the "17 shots stuck 生成中 forever, nothing happens" symptom.
//
// The production watchdog polls this globally. Exposed here as a shared,
// optionally episode-scoped function so a dev user (who isn't running the
// separate watchdog process) can trigger the same recovery from the workspace.
import { prisma } from "@/lib/db";
import { addTaskJob, isJobAlive } from "@/lib/task/queues";
import { getQueueForTaskType, type TaskType } from "@/lib/task/types";

export async function recoverOrphanedQueued(scope?: { episodeId?: string }): Promise<{ recovered: number; checked: number }> {
  const tasks = await prisma.task.findMany({
    where: { status: "queued", ...(scope?.episodeId ? { episodeId: scope.episodeId } : {}) },
    take: 500,
    select: { id: true, type: true },
  });
  let recovered = 0;
  for (const t of tasks) {
    const queue = getQueueForTaskType(t.type as TaskType);
    if (await isJobAlive(queue, t.id)) continue; // still queued for real — leave it
    await addTaskJob(queue, t.id, 1);
    recovered++;
  }
  return { recovered, checked: tasks.length };
}
