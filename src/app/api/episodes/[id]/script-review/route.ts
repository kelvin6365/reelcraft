import { withAuth } from "@/lib/api/with-auth";
import { ok } from "@/lib/api/errors";
import { getOwnedEpisode, submitEpisodeTask } from "@/lib/api/episode-actions";
import { TASK_TYPE } from "@/lib/task/types";

// 劇本體檢 (S3): checklist-based per-scene risk lights, review-by-exception.
export const POST = withAuth(
  async ({ userId, params }) => {
    const episode = await getOwnedEpisode(userId, params.id);
    // dedupeActive: repeat clicks while a review is still running reuse the task
    return ok(await submitEpisodeTask(userId, episode, TASK_TYPE.SCRIPT_REVIEW, { at: Date.now() }, { dedupeActive: true }));
  },
  { auditAction: "episode.script-review" },
);
