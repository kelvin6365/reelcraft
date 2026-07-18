import { withAuth } from "@/lib/api/with-auth";
import { ok } from "@/lib/api/errors";
import { getOwnedEpisode, submitEpisodeTask } from "@/lib/api/episode-actions";
import { TASK_TYPE } from "@/lib/task/types";

export const POST = withAuth(
  async ({ userId, params }) => {
    const episode = await getOwnedEpisode(userId, params.id);
    return ok(await submitEpisodeTask(userId, episode, TASK_TYPE.REWRITE_SCRIPT, { at: Date.now() }));
  },
  { auditAction: "episode.rewrite-script" },
);
