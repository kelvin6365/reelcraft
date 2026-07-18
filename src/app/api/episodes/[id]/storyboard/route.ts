import { withAuth } from "@/lib/api/with-auth";
import { ok } from "@/lib/api/errors";
import { getOwnedEpisode, submitEpisodeTask } from "@/lib/api/episode-actions";
import { TASK_TYPE } from "@/lib/task/types";

// One click: BUILD_SCENES chains into STORYBOARD_RUN via handler payload.then.
export const POST = withAuth(
  async ({ userId, params }) => {
    const episode = await getOwnedEpisode(userId, params.id);
    return ok(await submitEpisodeTask(userId, episode, TASK_TYPE.BUILD_SCENES, { at: Date.now(), then: TASK_TYPE.STORYBOARD_RUN }));
  },
  { auditAction: "episode.storyboard" },
);
