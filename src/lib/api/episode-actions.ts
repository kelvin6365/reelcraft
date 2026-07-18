// Shared helpers for episode action routes (submit a pipeline task for an episode).
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api/errors";
import { submitTask } from "@/lib/task/submit";
import type { TaskType } from "@/lib/task/types";
import type { Episode } from "@prisma/client";

export async function getOwnedEpisode(userId: string, episodeId: string): Promise<Episode> {
  const episode = await prisma.episode.findFirst({ where: { id: episodeId, userId } });
  if (!episode) throw new ApiError("NOT_FOUND", 404, "episode not found");
  return episode;
}

export async function submitEpisodeTask(
  userId: string,
  episode: Episode,
  type: TaskType,
  payload: Record<string, unknown> = {},
): Promise<{ taskId: string; deduped: boolean }> {
  return submitTask({
    userId,
    type,
    targetType: "episode",
    targetId: episode.id,
    projectId: episode.projectId,
    episodeId: episode.id,
    payload,
  });
}
