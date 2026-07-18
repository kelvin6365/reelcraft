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
  await prisma.project.update({ where: { id: project.id }, data: { lastAccessedAt: new Date() } });
  const episodes = await prisma.episode.findMany({
    where: { projectId: project.id },
    orderBy: { episodeNumber: "asc" },
    select: { id: true, episodeNumber: true, status: true, updatedAt: true },
  });
  return ok({ ...project, episodes });
});

export const PATCH = withAuth(
  async ({ userId, params, req }) => {
    await getOwned(userId, params.id);
    const body = (await req.json()) as Partial<{
      name: string;
      stylePackId: string;
      videoRatio: string;
      modelDefaults: Record<string, string>;
      budgetUsd: number | null;
    }>;
    const project = await prisma.project.update({
      where: { id: params.id },
      data: {
        name: body.name,
        stylePackId: body.stylePackId,
        videoRatio: body.videoRatio,
        modelDefaults: body.modelDefaults as object | undefined,
        budgetUsd: body.budgetUsd === undefined ? undefined : body.budgetUsd,
      },
    });
    return ok(project);
  },
  { auditAction: "project.update" },
);

export const DELETE = withAuth(
  async ({ userId, params }) => {
    await getOwned(userId, params.id);
    await prisma.project.delete({ where: { id: params.id } });
    return ok({ deleted: true });
  },
  { auditAction: "project.delete" },
);
