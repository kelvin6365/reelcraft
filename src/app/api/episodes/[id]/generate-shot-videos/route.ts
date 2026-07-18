import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ok } from "@/lib/api/errors";
import { getOwnedEpisode } from "@/lib/api/episode-actions";
import { submitTask } from "@/lib/task/submit";
import { TASK_TYPE } from "@/lib/task/types";

export const POST = withAuth(
  async ({ userId, params }) => {
    const episode = await getOwnedEpisode(userId, params.id);
    const shots = await prisma.shot.findMany({
      where: { episodeId: episode.id, videoMediaId: null, imageMediaId: { not: null } },
    });
    let submitted = 0;
    for (const shot of shots) {
      await submitTask({
        userId, type: TASK_TYPE.VIDEO_SHOT, targetType: "shot", targetId: shot.id,
        projectId: episode.projectId, episodeId: episode.id, payload: { at: Date.now() },
      });
      submitted++;
    }
    return ok({ submitted });
  },
  { auditAction: "episode.generate-shot-videos" },
);
