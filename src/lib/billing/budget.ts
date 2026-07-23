import { prisma } from "@/lib/db";
import { AiError } from "@/lib/ai/types";
import { getCapabilityEntry } from "@/lib/ai/capabilities";
import { resolveModelDefaults } from "@/lib/model-defaults/resolve";
import { sumActualCostUsd } from "@/lib/billing/actual-cost";

export async function getProjectSpendUsd(projectId: string): Promise<number> {
  return Number(await sumActualCostUsd({ projectId, status: "ok" }));
}

export async function getEpisodeSpendUsd(episodeId: string): Promise<number> {
  return Number(await sumActualCostUsd({ episodeId, status: "ok" }));
}

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

export interface ActiveModels {
  image: { modelKey: string; unitUsd: number | null };
  video: { modelKey: string; unitUsd: number | null; perSecond: number | null };
}

export interface DownstreamEstimate {
  pendingImages: number;
  pendingVideos: number;
  estImageUsd: number;
  estVideoUsd: number;
  totalUsd: number;
  videoUnitUsd: number | null;
  activeModels: ActiveModels;
}

export async function estimateDownstreamCost(userId: string, episodeId: string): Promise<DownstreamEstimate> {
  const episode = await prisma.episode.findUniqueOrThrow({
    where: { id: episodeId },
    include: { project: { select: { modelDefaults: true } } },
  });
  const defaults = await resolveModelDefaults(userId, episode.project);
  const shots = await prisma.shot.findMany({
    where: { episodeId },
    select: { imageMediaId: true, videoMediaId: true, durationMs: true },
  });

  const pendingImages = shots.filter((s) => !s.imageMediaId).length;
  const pendingVideos = shots.filter((s) => !s.videoMediaId).length;

  const imageEntry = getCapabilityEntry(defaults.image);
  const videoEntry = getCapabilityEntry(defaults.video);
  const imagePricing = imageEntry?.pricing;
  const videoPricing = videoEntry?.pricing;
  const imageUnitUsd = imagePricing && "unit" in imagePricing && imagePricing.unit === "image" ? Number(imagePricing.perUnit) : null;
  const videoPerSecUsd = videoPricing && "unit" in videoPricing && videoPricing.unit === "second" ? Number(videoPricing.perUnit) : null;
  const perShotSec = videoEntry?.capabilities?.durationsSec?.length
    ? Math.min(...videoEntry.capabilities.durationsSec)
    : 5;
  const videoUnitUsd = videoPerSecUsd !== null ? perShotSec * videoPerSecUsd : null;

  const estImageUsd = pendingImages * (imageUnitUsd ?? 0);
  const estVideoUsd = pendingVideos * (videoUnitUsd ?? 0);
  return {
    pendingImages,
    pendingVideos,
    estImageUsd,
    estVideoUsd,
    totalUsd: estImageUsd + estVideoUsd,
    videoUnitUsd,
    activeModels: {
      image: { modelKey: defaults.image, unitUsd: imageUnitUsd },
      video: { modelKey: defaults.video, unitUsd: videoUnitUsd, perSecond: videoPerSecUsd },
    },
  };
}
