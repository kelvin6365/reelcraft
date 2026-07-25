import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { buildEpisodeView } from "@/lib/api/episode-snapshot";
import { estimateDownstreamCost, getEpisodeSpendUsd, getProjectSpendUsd } from "@/lib/billing/budget";
import { getOwnedEpisode } from "@/lib/api/episode-actions";
import { advanceAfterTask } from "@/lib/batch/advance";

export const GET = withAuth(async ({ userId, params }) => {
  const view = await buildEpisodeView(userId, params.id);
  const [downstream, projectSpendUsd, episodeSpendUsd] = await Promise.all([
    estimateDownstreamCost(userId, params.id).catch(() => null),
    getProjectSpendUsd(view.episode.projectId).catch(() => 0),
    getEpisodeSpendUsd(params.id).catch(() => 0),
  ]);
  return ok({
    ...view,
    cost: { projectSpendUsd, episodeSpendUsd, downstream, activeModels: downstream?.activeModels ?? null },
  });
});

// Toggle assisted auto-advance for a single episode (docs/plans/... assisted
// auto-advance design). Episode.autorun stays the single engine-enabled flag;
// autorunConfig's mode discriminates batch vs assisted.
export const PATCH = withAuth(
  async ({ userId, params, req }) => {
    const body = (await req.json().catch(() => ({}))) as { autoAdvance?: unknown };
    if (typeof body.autoAdvance !== "boolean") throw new ApiError("BAD_REQUEST", 400, "autoAdvance must be boolean");

    const episode = await getOwnedEpisode(userId, params.id);
    const cfg = (episode.autorunConfig ?? {}) as { mode?: "batch" | "assisted"; moneyAuthorized?: boolean };

    if (cfg.mode === "batch" && episode.autorun) {
      throw new ApiError("BATCH_RUNNING", 409, "批量生成進行中，請先停止批量");
    }

    if (body.autoAdvance) {
      await prisma.episode.update({
        where: { id: episode.id },
        data: { autorun: true, autorunConfig: { ...cfg, mode: "assisted" } },
      });
      advanceAfterTask(episode.id);
    } else {
      await prisma.episode.update({ where: { id: episode.id }, data: { autorun: false } });
    }

    return ok({ autoAdvance: body.autoAdvance });
  },
  { auditAction: "episode.auto-advance" },
);
