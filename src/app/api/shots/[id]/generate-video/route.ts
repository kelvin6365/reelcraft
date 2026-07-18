// Single-shot video (re)generation.
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { submitTask } from "@/lib/task/submit";
import { TASK_TYPE } from "@/lib/task/types";

export const POST = withAuth(
  async ({ userId, params }) => {
    const shot = await prisma.shot.findFirst({ where: { id: params.id, userId } });
    if (!shot) throw new ApiError("NOT_FOUND", 404);
    if (!shot.imageMediaId) throw new ApiError("NO_IMAGE", 400, "generate the shot image first");
    const episode = await prisma.episode.findUniqueOrThrow({ where: { id: shot.episodeId } });
    return ok(
      await submitTask({
        userId, type: TASK_TYPE.VIDEO_SHOT, targetType: "shot", targetId: shot.id,
        projectId: episode.projectId, episodeId: episode.id, payload: { at: Date.now() },
      }),
    );
  },
  { auditAction: "shot.regenerate-video" },
);
