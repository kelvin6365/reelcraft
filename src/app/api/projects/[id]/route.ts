import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok, fail } from "@/lib/api/errors";
import { planResultFromJson, summarizeRisk } from "@/lib/planning/plan";
import { sanitizeProjectModelDefaults } from "@/lib/model-defaults/sanitize";

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
    select: { id: true, episodeNumber: true, status: true, updatedAt: true, autorun: true },
  });
  // Failed-task counts per episode drive the batch board's red light. Scoped by
  // this project's episode ids, so no extra userId filter is needed.
  const failed = await prisma.task.groupBy({
    by: ["episodeId"],
    where: { status: "failed", episodeId: { in: episodes.map((e) => e.id) } },
    _count: { _all: true },
  });
  const failedByEp = new Map(failed.map((f) => [f.episodeId, f._count._all]));
  const episodesWithFailed = episodes.map((e) => ({ ...e, failedTasks: failedByEp.get(e.id) ?? 0 }));
  const planEpisodes = planResultFromJson(project.planResult).episodes;
  return ok({ ...project, episodes: episodesWithFailed, planRisk: summarizeRisk(planEpisodes) });
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
      sourceText: string;
      theme: string;
    }>;

    // theme is replayed into every split/rewrite prompt — cap it so a huge or
    // non-string value can't drive unbounded token spend.
    if (body.theme !== undefined && typeof body.theme !== "string") {
      return fail("BAD_REQUEST", 400, "theme must be a string");
    }
    const theme = body.theme === undefined ? undefined : body.theme.slice(0, 500);

    let modelDefaults: object | undefined;
    if (body.modelDefaults !== undefined) {
      const sanitized = sanitizeProjectModelDefaults(body.modelDefaults);
      if (!sanitized.ok) return fail(sanitized.error.code, 400, sanitized.error.message);
      modelDefaults = sanitized.value as object;
    }

    const project = await prisma.project.update({
      where: { id: params.id },
      data: {
        name: body.name,
        stylePackId: body.stylePackId,
        videoRatio: body.videoRatio,
        modelDefaults,
        budgetUsd: body.budgetUsd === undefined ? undefined : body.budgetUsd,
        sourceText: body.sourceText,
        theme,
      },
    });
    return ok(project);
  },
  { auditAction: "project.update" },
);

export const DELETE = withAuth(
  async ({ userId, params }) => {
    await getOwned(userId, params.id);
    // PromptOverride.projectId has no FK (mirrors Task.projectId by design),
    // so project-layer overrides would otherwise be orphaned forever.
    await prisma.promptOverride.deleteMany({ where: { userId, projectId: params.id } });
    await prisma.project.delete({ where: { id: params.id } });
    return ok({ deleted: true });
  },
  { auditAction: "project.delete" },
);
