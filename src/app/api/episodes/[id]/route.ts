import { withAuth } from "@/lib/api/with-auth";
import { ok } from "@/lib/api/errors";
import { buildEpisodeView } from "@/lib/api/episode-snapshot";
import { estimateDownstreamCost, getEpisodeSpendUsd, getProjectSpendUsd } from "@/lib/billing/budget";

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
