import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ok } from "@/lib/api/errors";
import { getOwnedEpisode, submitEpisodeTask } from "@/lib/api/episode-actions";
import { TASK_TYPE } from "@/lib/task/types";

// One click: BUILD_SCENES chains into STORYBOARD_RUN via handler payload.then.
// Also serves regen: rebuild wipes scenes/shots, so a previously confirmed
// episode drops back to the storyboard review gate.
export const POST = withAuth(
  async ({ userId, params }) => {
    const episode = await getOwnedEpisode(userId, params.id);
    if (["images", "videos", "export", "done"].includes(episode.status)) {
      await prisma.episode.update({ where: { id: episode.id }, data: { status: "storyboard" } });
    }
    return ok(
      await submitEpisodeTask(userId, episode, TASK_TYPE.BUILD_SCENES, { at: Date.now(), then: TASK_TYPE.STORYBOARD_RUN }, { dedupeActive: true }),
    );
  },
  { auditAction: "episode.storyboard" },
);
