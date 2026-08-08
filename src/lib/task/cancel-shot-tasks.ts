// Cancel in-flight image/video tasks for shots that are about to disappear.
//
// Without this, deleting a shot (or regenerating the storyboard, which wipes and
// rebuilds every shot) leaves its queued/processing IMAGE_SHOT / VIDEO_SHOT tasks
// running against a row that no longer exists. The handler then spends the
// generation, tries to write the result back, and crashes on a "record not
// found". Marking the tasks canceled is enough to stop them: the worker claims
// tasks with a `status: 'queued'` guard, so a canceled task is never picked up,
// and a canceled task's completion write (guarded by `status: 'processing'`) is
// discarded. For a QUEUED task this also avoids the wasted spend entirely; a task
// already mid-generation has spent — the cancel just prevents the crash.
//
// Because neither settle nor rollback runs on a canceled task, we release its
// billing reservation here — otherwise a canceled task's freeze stays pending
// forever and leaks the user's spendable balance under ENFORCE.
import { prisma } from "@/lib/db";
import { publishTaskEvent } from "@/lib/task/events";
import { rollbackTaskFreeze } from "@/lib/billing/ledger";
import { cancelPendingForTask } from "@/lib/ai/request-journal";
import { TASK_TYPE } from "@/lib/task/types";

export async function cancelActiveShotTasks(episodeId: string, shotIds: string[]): Promise<number> {
  if (shotIds.length === 0) return 0;
  const active = await prisma.task.findMany({
    where: {
      episodeId,
      targetId: { in: shotIds },
      type: { in: [TASK_TYPE.IMAGE_SHOT, TASK_TYPE.VIDEO_SHOT] },
      status: { in: ["queued", "processing"] },
    },
    select: { id: true, type: true, projectId: true },
  });
  if (active.length === 0) return 0;
  await prisma.task.updateMany({
    where: { id: { in: active.map((t) => t.id) } },
    data: { status: "canceled", finishedAt: new Date() },
  });
  for (const t of active) {
    await rollbackTaskFreeze(t.id); // release the reservation — no settle/rollback will run otherwise
    // 仲喺 provider 嗰邊燒緊 GPU 嘅 request：主動叫停。冇人會再收貨，唔叫停就
    // 係白俾錢（best-effort，失敗只 log，見 request-journal.ts）。
    await cancelPendingForTask(t.id);
    publishTaskEvent(t.projectId, { taskId: t.id, taskType: t.type, eventType: "CANCELED" });
  }
  return active.length;
}
