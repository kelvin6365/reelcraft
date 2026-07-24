import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { activeFailures } from "@/lib/task/superseded";

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
      queuedAt: true,
      finishedAt: true,
    },
  });

  // Same superseded filter as the episode drawer — a project-wide list must not
  // resurrect failures a later regeneration already fixed.
  const completed = await prisma.task.findMany({
    where: { userId, projectId: project.id, status: "completed" },
    select: { type: true, targetId: true, queuedAt: true, finishedAt: true, episodeId: true },
  });
  const unresolved = activeFailures(tasks, completed);

  const episodeIds = [...new Set(unresolved.map((t) => t.episodeId).filter((id): id is string => !!id))];
  const episodes = await prisma.episode.findMany({
    where: { id: { in: episodeIds } },
    select: { id: true, episodeNumber: true },
  });
  const episodeNumberById = new Map(episodes.map((e) => [e.id, e.episodeNumber]));

  return ok(
    unresolved.map((t) => ({
      ...t,
      episodeNumber: t.episodeId ? (episodeNumberById.get(t.episodeId) ?? null) : null,
    })),
  );
});
