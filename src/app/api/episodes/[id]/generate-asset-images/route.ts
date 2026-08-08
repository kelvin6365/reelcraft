// Fan out IMAGE_CHARACTER / IMAGE_LOCATION / IMAGE_PROP for every asset without candidates.
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ok } from "@/lib/api/errors";
import { getOwnedEpisode } from "@/lib/api/episode-actions";
import { submitTask } from "@/lib/task/submit";
import { TASK_TYPE } from "@/lib/task/types";

export const POST = withAuth(
  async ({ userId, params }) => {
    const episode = await getOwnedEpisode(userId, params.id);
    const [characters, locations, props] = await Promise.all([
      prisma.character.findMany({ where: { projectId: episode.projectId, locked: false } }),
      prisma.location.findMany({ where: { projectId: episode.projectId, locked: false } }),
      prisma.prop.findMany({ where: { projectId: episode.projectId, locked: false } }),
    ]);

    const submitted: string[] = [];
    for (const c of characters) {
      if ((c.candidates as string[]).length > 0) continue;
      const { taskId } = await submitTask({
        userId, type: TASK_TYPE.IMAGE_CHARACTER, targetType: "character", targetId: c.id,
        projectId: episode.projectId, episodeId: episode.id, payload: { at: Date.now() },
      });
      submitted.push(taskId);
    }
    for (const l of locations) {
      if ((l.candidates as string[]).length > 0) continue;
      const { taskId } = await submitTask({
        userId, type: TASK_TYPE.IMAGE_LOCATION, targetType: "location", targetId: l.id,
        projectId: episode.projectId, episodeId: episode.id, payload: { at: Date.now() },
      });
      submitted.push(taskId);
    }
    for (const p of props) {
      if ((p.candidates as string[]).length > 0) continue;
      const { taskId } = await submitTask({
        userId, type: TASK_TYPE.IMAGE_PROP, targetType: "prop", targetId: p.id,
        projectId: episode.projectId, episodeId: episode.id, payload: { at: Date.now() },
      });
      submitted.push(taskId);
    }
    return ok({ submitted: submitted.length });
  },
  { auditAction: "episode.generate-asset-images" },
);
