// 進階模式 (advanced prompt mode) — slice 3「編輯重跑」. Submits a fresh, billable
// task with a one-off prompt override for a single promptId. Validation happens
// HERE (not just inside the worker) — if it only failed at render time, the
// billing freeze in submitTask/freezeBalance would already have been taken.
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ok, fail } from "@/lib/api/errors";
import { getOwnedEpisode, submitEpisodeTask } from "@/lib/api/episode-actions";
import { getCatalogEntry } from "@/lib/prompts/build-prompt";
import { checkOverridePlaceholders } from "@/lib/prompts/placeholders";
import { PROMPT_TASK } from "@/lib/prompts/prompt-task-map";
import { ACTIVE_STATUSES } from "@/lib/task/types";

const MAX_LENGTH = 100_000;

export const POST = withAuth(
  async ({ userId, req, params }) => {
    const episode = await getOwnedEpisode(userId, params.id);

    let body: { promptId?: unknown; content?: unknown };
    try {
      body = await req.json();
    } catch {
      return fail("INVALID_BODY", 400, "body must be JSON");
    }
    const { promptId, content } = body;
    if (typeof promptId !== "string" || typeof content !== "string") {
      return fail("INVALID_BODY", 400, "promptId and content are required strings");
    }

    const entry = getCatalogEntry(promptId);
    if (!entry) return fail("PROMPT_NOT_FOUND", 404, `no catalog entry for promptId: ${promptId}`);

    const taskEntry = PROMPT_TASK[promptId];
    if (!taskEntry || taskEntry.scope !== "episode") {
      return fail("PROMPT_SCOPE_INVALID", 400, `${promptId} is not episode-scoped and cannot be rerun from a station`);
    }

    if (content.length > MAX_LENGTH) {
      return fail("PROMPT_OVERRIDE_INVALID", 400, `content exceeds ${MAX_LENGTH} characters`);
    }

    const check = checkOverridePlaceholders(entry.variables, content);
    if (!check.ok) return fail(check.code, 400, check.message);

    const activeTask = await prisma.task.findFirst({
      where: { userId, type: taskEntry.taskType, targetId: episode.id, status: { in: ACTIVE_STATUSES } },
      select: { id: true },
    });
    if (activeTask) return fail("TASK_ACTIVE", 409, "呢個站有生成緊嘅任務，等佢完成先");

    // NOTE: deliberately no dedupeActive — it collapses on (type, targetId)
    // ignoring payload, which would silently hand back the running task's id
    // and drop the user's edited prompt. The 409 guard above replaces it.
    const { taskId } = await submitEpisodeTask(userId, episode, taskEntry.taskType, {
      at: Date.now(),
      promptOverrides: { [promptId]: content },
    });

    return ok({ taskId });
  },
  { auditAction: "episode.prompt-rerun" },
);
