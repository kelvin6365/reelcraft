// Project budget guard (M3 — lesson from the first real episode, where a real
// storyboard produced 2.5x the shot count of the canned estimate).
import { prisma } from "@/lib/db";
import { AiError } from "@/lib/ai/types";
import { getCapabilityEntry } from "@/lib/ai/capabilities";

export async function getProjectSpendUsd(projectId: string): Promise<number> {
  const agg = await prisma.aiCallLog.aggregate({
    where: { projectId, status: "ok" },
    _sum: { estCostUsd: true },
  });
  return Number(agg._sum.estCostUsd ?? 0);
}

// Throws BUDGET_EXCEEDED (terminal) when the project has a cap and spend reached it.
// Called by generate-media before every media call — the expensive path.
export async function assertWithinBudget(projectId: string | undefined): Promise<void> {
  if (!projectId) return;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { budgetUsd: true },
  });
  if (!project?.budgetUsd) return;
  const spent = await getProjectSpendUsd(projectId);
  const cap = Number(project.budgetUsd);
  if (spent >= cap) {
    throw new AiError(
      "BUDGET_EXCEEDED",
      `project spend $${spent.toFixed(2)} reached budget cap $${cap.toFixed(2)} — raise budgetUsd or review usage`,
      false,
    );
  }
}

export interface DownstreamEstimate {
  pendingImages: number;
  pendingVideos: number;
  estImageUsd: number;
  estVideoUsd: number;
  totalUsd: number;
  videoUnitUsd: number | null;
}

// Cost preview for the storyboard confirm gate: what will the remaining
// pipeline roughly cost with the project's current model defaults?
export async function estimateDownstreamCost(episodeId: string): Promise<DownstreamEstimate> {
  const episode = await prisma.episode.findUniqueOrThrow({
    where: { id: episodeId },
    include: { project: { select: { modelDefaults: true } } },
  });
  const defaults = (episode.project.modelDefaults ?? {}) as { image?: string; video?: string };
  const shots = await prisma.shot.findMany({
    where: { episodeId },
    select: { imageMediaId: true, videoMediaId: true, durationMs: true },
  });

  const pendingImages = shots.filter((s) => !s.imageMediaId).length;
  const pendingVideos = shots.filter((s) => !s.videoMediaId).length;

  const imageEntry = defaults.image ? getCapabilityEntry(defaults.image) : null;
  const videoEntry = defaults.video ? getCapabilityEntry(defaults.video) : null;
  const imagePricing = imageEntry?.pricing;
  const videoPricing = videoEntry?.pricing;
  const imageUnit = imagePricing && "unit" in imagePricing && imagePricing.unit === "image" ? Number(imagePricing.perUnit) : 0;
  const videoPerSec = videoPricing && "unit" in videoPricing && videoPricing.unit === "second" ? Number(videoPricing.perUnit) : 0;
  // real models snap to allowed durations; assume the smallest allowed (usually 5s)
  const perShotSec = videoEntry?.capabilities?.durationsSec?.length
    ? Math.min(...videoEntry.capabilities.durationsSec)
    : 5;

  const estImageUsd = pendingImages * imageUnit;
  const estVideoUsd = pendingVideos * perShotSec * videoPerSec;
  return {
    pendingImages,
    pendingVideos,
    estImageUsd,
    estVideoUsd,
    totalUsd: estImageUsd + estVideoUsd,
    videoUnitUsd: videoPerSec > 0 ? perShotSec * videoPerSec : null,
  };
}
