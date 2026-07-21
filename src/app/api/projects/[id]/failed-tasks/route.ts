// Project-level failure overview: every failed task across this project's episodes,
// with the episode number attached so the UI can group rows per episode
// (ProjectFailurePanel card near the top of /projects/:id).
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";

async function getOwned(userId: string, id: string) {
  const project = await prisma.project.findFirst({ where: { id, userId } });
  if (!project) throw new ApiError("NOT_FOUND", 404);
  return project;
}

export const GET = withAuth(async ({ userId, params }) => {
  const project = await getOwned(userId, params.id);

  const tasks = await prisma.task.findMany({
    where: { userId, projectId: project.id, status: "failed" },
    orderBy: { queuedAt: "desc" },
    take: 500,
    select: {
      id: true,
      type: true,
      status: true,
      progress: true,
      attempt: true,
      errorCode: true,
      errorMessage: true,
      targetType: true,
      targetId: true,
      episodeId: true,
    },
  });

  // Task.episodeId has no Prisma relation to Episode, so episode numbers are
  // resolved with a second lookup (same pattern as GET /api/projects/:id).
  const episodeIds = [...new Set(tasks.map((t) => t.episodeId).filter((id): id is string => !!id))];
  const episodes = await prisma.episode.findMany({
    where: { id: { in: episodeIds } },
    select: { id: true, episodeNumber: true },
  });
  const episodeNumberById = new Map(episodes.map((e) => [e.id, e.episodeNumber]));

  return ok(
    tasks.map((t) => ({
      ...t,
      episodeNumber: t.episodeId ? (episodeNumberById.get(t.episodeId) ?? null) : null,
    })),
  );
});
