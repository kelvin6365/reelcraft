// 批量出片: turn autorun on/off for a project's episodes and kick the advance
// engine (docs/plans/2026-07-19-batch-generation-design.md).
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { advanceEpisode } from "@/lib/batch/advance";

async function getOwned(userId: string, id: string) {
  const project = await prisma.project.findFirst({ where: { id, userId } });
  if (!project) throw new ApiError("NOT_FOUND", 404);
  return project;
}

export const POST = withAuth(
  async ({ userId, params, req }) => {
    const project = await getOwned(userId, params.id);
    const body = (await req.json().catch(() => ({}))) as Partial<{
      episodeIds: string[];
      autoConfirmStoryboard: boolean;
      skipVideo: boolean;
    }>;

    // Precondition: assets are project-level and lock once for the whole season.
    // Batch without locked assets would stall every episode at the same gate.
    const [characters, locations] = await Promise.all([
      prisma.character.findMany({ where: { projectId: project.id }, select: { locked: true } }),
      prisma.location.findMany({ where: { projectId: project.id }, select: { locked: true } }),
    ]);
    const assets = [...characters, ...locations];
    if (assets.length === 0 || assets.some((a) => !a.locked)) {
      throw new ApiError("ASSETS_NOT_LOCKED", 400, "請先完成資產鎖定（角色/場景揀圖）再開始批量生成");
    }

    const episodes = await prisma.episode.findMany({
      where: {
        projectId: project.id,
        userId,
        ...(body.episodeIds?.length ? { id: { in: body.episodeIds } } : {}),
      },
      select: { id: true, exportMediaId: true },
      orderBy: { episodeNumber: "asc" },
    });
    if (episodes.length === 0) throw new ApiError("NO_EPISODES", 400, "冇集數可以批量生成");

    const autorunConfig = {
      autoConfirmStoryboard: body.autoConfirmStoryboard ?? true,
      skipVideo: body.skipVideo ?? false,
    };
    const targets = episodes.filter((e) => !e.exportMediaId); // already-exported episodes stay untouched
    await prisma.episode.updateMany({
      where: { id: { in: targets.map((e) => e.id) } },
      data: { autorun: true, autorunConfig },
    });

    // Kick every episode once — each then self-advances off task completions.
    // Sequential await keeps quota/budget errors deterministic; failures of one
    // episode's kick must not block the rest.
    const kicked: Record<string, string> = {};
    for (const e of targets) {
      try {
        kicked[e.id] = await advanceEpisode(e.id);
      } catch (err) {
        kicked[e.id] = `error:${String(err).slice(0, 200)}`;
      }
    }
    return ok({ started: targets.length, skippedDone: episodes.length - targets.length, config: autorunConfig, kicked });
  },
  { auditAction: "batch.start" },
);

export const DELETE = withAuth(
  async ({ userId, params }) => {
    await getOwned(userId, params.id);
    // Stop = clear the flags. In-flight tasks finish normally; the hook simply
    // stops chaining (advanceEpisode sees autorun=false).
    const cleared = await prisma.episode.updateMany({
      where: { projectId: params.id, userId, autorun: true },
      data: { autorun: false },
    });
    return ok({ stopped: cleared.count });
  },
  { auditAction: "batch.stop" },
);
