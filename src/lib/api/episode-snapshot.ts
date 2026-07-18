// Builds the aggregate view for GET /api/episodes/:id — the single source the
// UI needs: stage states, counts, and the Next Best Action.
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api/errors";
import { computeNextAction, computeStages, type EpisodeSnapshot } from "@/lib/next-action";
import { attachMediaUrls } from "@/lib/media/service";
import { ACTIVE_STATUSES } from "@/lib/task/types";

// storyboard is "confirmed" once the episode has advanced past the review gate
const CONFIRMED_STATUSES = ["images", "videos", "export", "done"];

export async function buildEpisodeView(userId: string, episodeId: string) {
  const episode = await prisma.episode.findFirst({
    where: { id: episodeId, userId },
    include: { project: true },
  });
  if (!episode) throw new ApiError("NOT_FOUND", 404, "episode not found");

  const [characters, locations, scenes, shots, voiceLines, activeTasks, failedTasks] = await Promise.all([
    prisma.character.findMany({ where: { projectId: episode.projectId } }),
    prisma.location.findMany({ where: { projectId: episode.projectId } }),
    prisma.scene.count({ where: { episodeId } }),
    prisma.shot.findMany({ where: { episodeId }, orderBy: { shotIndex: "asc" } }),
    prisma.voiceLine.findMany({ where: { episodeId }, orderBy: { lineIndex: "asc" } }),
    prisma.task.findMany({ where: { episodeId, status: { in: ACTIVE_STATUSES } }, select: { type: true } }),
    prisma.task.count({ where: { episodeId, status: "failed" } }),
  ]);

  const snapshot: EpisodeSnapshot = {
    hasRawText: episode.rawText.length > 0,
    hasScript: episode.scriptText.length > 0,
    characters: {
      total: characters.length,
      locked: characters.filter((c) => c.locked).length,
      withCandidates: characters.filter((c) => (c.candidates as string[]).length > 0).length,
    },
    locations: {
      total: locations.length,
      locked: locations.filter((l) => l.locked).length,
      withCandidates: locations.filter((l) => (l.candidates as string[]).length > 0).length,
    },
    scenes,
    shots: {
      total: shots.length,
      withImage: shots.filter((sh) => sh.imageMediaId).length,
      withVideo: shots.filter((sh) => sh.videoMediaId).length,
    },
    storyboardConfirmed: CONFIRMED_STATUSES.includes(episode.status),
    voiceLines: {
      total: voiceLines.length,
      withAudio: voiceLines.filter((v) => v.audioMediaId).length,
    },
    hasExport: Boolean(episode.exportMediaId),
    runningTaskTypes: activeTasks.map((t) => t.type),
    failedTasks,
  };

  const [charactersWithUrls, locationsWithUrls, shotsWithUrls, voiceLinesWithUrls, episodeWithUrl] = await Promise.all([
    attachMediaUrls(characters, ["lockedImageMediaId"]),
    attachMediaUrls(locations, ["lockedImageMediaId"]),
    attachMediaUrls(shots, ["imageMediaId", "videoMediaId"]),
    attachMediaUrls(voiceLines, ["audioMediaId"]),
    attachMediaUrls([episode], ["exportMediaId"]),
  ]);

  // candidate grids need URLs too (3-choose-1 lock UI)
  const { getStorage } = await import("@/lib/storage");
  const storage = getStorage();
  const allCandidateIds = [
    ...characters.flatMap((c) => c.candidates as string[]),
    ...locations.flatMap((l) => l.candidates as string[]),
  ];
  const candidateMedia = allCandidateIds.length
    ? await prisma.mediaObject.findMany({ where: { id: { in: allCandidateIds } } })
    : [];
  const candidateUrlById: Record<string, string> = {};
  for (const m of candidateMedia) candidateUrlById[m.id] = await storage.getSignedUrl(m.storageKey, 3600);

  return {
    candidateUrlById,
    episode: {
      id: episode.id,
      projectId: episode.projectId,
      episodeNumber: episode.episodeNumber,
      status: episode.status,
      rawText: episode.rawText,
      scriptText: episode.scriptText,
      exportUrl: (episodeWithUrl[0] as { exportUrl?: string | null }).exportUrl ?? null,
      project: {
        id: episode.project.id,
        name: episode.project.name,
        stylePackId: episode.project.stylePackId,
        videoRatio: episode.project.videoRatio,
      },
    },
    characters: charactersWithUrls,
    locations: locationsWithUrls,
    shots: shotsWithUrls,
    voiceLines: voiceLinesWithUrls,
    stages: computeStages(snapshot),
    nextAction: computeNextAction(snapshot, episodeId),
    failedTasks,
  };
}
