// Project budget guard (M3 — lesson from the first real episode, where a real
// storyboard produced 2.5x the shot count of the canned estimate).
import { prisma } from "@/lib/db";
import { AiError } from "@/lib/ai/types";
import { getCapabilityEntry } from "@/lib/ai/capabilities";
import { resolveModelDefaults } from "@/lib/model-defaults/resolve";
import { sumActualCostUsd } from "@/lib/billing/actual-cost";

export async function getProjectSpendUsd(projectId: string): Promise<number> {
  return Number(await sumActualCostUsd({ projectId, status: "ok" }));
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

// Cost preview for the storyboard confirm gate: what will the remaining
// pipeline roughly cost with the project's current model defaults?
export async function estimateDownstreamCost(userId: string, episodeId: string): Promise<DownstreamEstimate> {
  const episode = await prisma.episode.findUniqueOrThrow({
    where: { id: episodeId },
    include: { project: { select: { modelDefaults: true } } },
  });
  // Same three-layer resolution the worker runs, so a project with no overrides
  // is priced from the real system defaults rather than treated as free.
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
  // null (not 0) when the catalog has no pricing for this slot — the
  // billing-gap-as-null convention; the UI renders that as "—" rather than $0.
  const imageUnitUsd = imagePricing && "unit" in imagePricing && imagePricing.unit === "image" ? Number(imagePricing.perUnit) : null;
  const videoPerSecUsd = videoPricing && "unit" in videoPricing && videoPricing.unit === "second" ? Number(videoPricing.perUnit) : null;
  // real models snap to allowed durations; assume the smallest allowed (usually 5s)
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
