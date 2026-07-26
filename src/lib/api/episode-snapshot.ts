import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api/errors";
import { computeNextAction, computeStages, type EpisodeSnapshot } from "@/lib/next-action";
import { attachMediaUrls } from "@/lib/media/service";
import { ACTIVE_STATUSES } from "@/lib/task/types";
import { countByStage } from "@/lib/task/stage-map";
import { activeFailures } from "@/lib/task/superseded";
import { resolveModelDefaults } from "@/lib/model-defaults/resolve";
import { effectiveImageModelKey } from "@/lib/ai/generate-media";
import { getCapabilities } from "@/lib/ai/capabilities";

const CONFIRMED_STATUSES = ["images", "videos", "export", "done"];

export async function buildEpisodeSnapshot(
  episode: { id: string; projectId: string; rawText: string; scriptText: string; status: string; exportMediaId: string | null },
  inputType: string,
): Promise<{ snapshot: EpisodeSnapshot; characters: Awaited<ReturnType<typeof prisma.character.findMany>>; locations: Awaited<ReturnType<typeof prisma.location.findMany>>; shots: Awaited<ReturnType<typeof prisma.shot.findMany>>; voiceLines: Awaited<ReturnType<typeof prisma.voiceLine.findMany>>; activeTasks: { id: string; type: string; targetId: string; status: string; progress: number; queuedAt: Date; heartbeatAt: Date | null }[]; failedTaskTypes: string[] }> {
  const episodeId = episode.id;
  const [characters, locations, scenes, shots, voiceLines, activeTasks, terminalTasks] = await Promise.all([
    // id is UUID v7 (time-ordered) → creation/extraction order. Without an
    // orderBy, Postgres reorders rows after UPDATEs (lock/regen), making the
    // asset cards jump around in the UI.
    prisma.character.findMany({ where: { projectId: episode.projectId }, orderBy: { id: "asc" } }),
    prisma.location.findMany({ where: { projectId: episode.projectId }, orderBy: { id: "asc" } }),
    prisma.scene.count({ where: { episodeId } }),
    prisma.shot.findMany({ where: { episodeId }, orderBy: { shotIndex: "asc" } }),
    prisma.voiceLine.findMany({ where: { episodeId }, orderBy: { lineIndex: "asc" } }),
    prisma.task.findMany({ where: { episodeId, status: { in: ACTIVE_STATUSES } }, select: { id: true, type: true, targetId: true, status: true, progress: true, queuedAt: true, heartbeatAt: true } }),
    prisma.task.findMany({
      where: { episodeId, status: { in: ["failed", "completed"] } },
      select: { type: true, targetId: true, status: true, queuedAt: true, finishedAt: true },
    }),
  ]);

  // Outstanding failures, one per target: drop those a later success fixed, then
  // collapse repeated failures on the same shot to the latest. See superseded.ts.
  const unresolvedFailures = activeFailures(
    terminalTasks.filter((t) => t.status === "failed"),
    terminalTasks.filter((t) => t.status === "completed"),
  );

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
    isSrtMode: inputType === "srt",
    voiceLines: {
      total: voiceLines.length,
      withAudio: voiceLines.filter((v) => v.audioMediaId).length,
    },
    hasExport: Boolean(episode.exportMediaId),
    runningTaskTypes: activeTasks.map((t) => t.type),
    failedTasks: unresolvedFailures.length,
  };
  return { snapshot, characters, locations, shots, voiceLines, activeTasks, failedTaskTypes: unresolvedFailures.map((t) => t.type) };
}

export async function buildEpisodeView(userId: string, episodeId: string) {
  const episode = await prisma.episode.findFirst({
    where: { id: episodeId, userId },
    include: { project: true },
  });
  if (!episode) throw new ApiError("NOT_FOUND", 404, "episode not found");

  const { snapshot, characters, locations, shots, voiceLines, activeTasks, failedTaskTypes } = await buildEpisodeSnapshot(episode, episode.project.inputType);
  const failedTasks = snapshot.failedTasks;
  const autorunCfg = (episode.autorunConfig ?? {}) as { mode?: "batch" | "assisted"; moneyAuthorized?: boolean };

  const activeByKey = new Map<string, { taskId: string; status: string; progress: number }>();
  for (const t of activeTasks) {
    if (t.targetId) activeByKey.set(`${t.type}:${t.targetId}`, { taskId: t.id, status: t.status, progress: t.progress });
  }

  // "Stuck" = queued tasks that nobody is consuming (worker down / dev reload
  // dropped the consumer / leaked gate slots). The tell is that NOTHING is
  // processing — if any task is processing, the queue is moving and old-queued
  // tasks are just waiting behind a busy concurrency cap or a retry backoff, not
  // stuck. Gating on zero-processing avoids the false "N 個任務卡住" alarm a busy
  // batch would otherwise trip. Drives the workspace's 重新排隊 affordance.
  const STUCK_MS = 60_000;
  const now = Date.now();
  const anyProcessing = activeTasks.some((t) => t.status === "processing");
  const stuckTasks = anyProcessing
    ? 0
    : activeTasks.filter((t) => !t.heartbeatAt && now - new Date(t.queuedAt).getTime() > STUCK_MS).length;

  const [charactersWithUrls, locationsWithUrls, shotsWithUrls, voiceLinesWithUrls, episodeWithUrl] = await Promise.all([
    attachMediaUrls(characters, ["lockedImageMediaId", "faceImageMediaId", "refFaceMediaId"]),
    attachMediaUrls(locations, ["lockedImageMediaId"]),
    attachMediaUrls(shots, ["imageMediaId", "videoMediaId"]),
    attachMediaUrls(voiceLines, ["audioMediaId"]),
    attachMediaUrls([episode], ["exportMediaId"]),
  ]);

  // 墊臉 UI affordance is only worth showing when the resolved image model
  // actually takes reference images — either natively, or via the
  // text-to-image → edit swap effectiveImageModelKey performs when refs exist.
  const resolvedModels = await resolveModelDefaults(userId, episode.project);
  const imageRefSupported =
    getCapabilities(resolvedModels.image)?.supportsReferenceImages === true ||
    effectiveImageModelKey(resolvedModels.image, true) !== resolvedModels.image;

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
    imageRefSupported,
    episode: {
      id: episode.id,
      projectId: episode.projectId,
      episodeNumber: episode.episodeNumber,
      status: episode.status,
      rawText: episode.rawText,
      scriptText: episode.scriptText,
      scriptReview: episode.scriptReview,
      exportUrl: (episodeWithUrl[0] as { exportUrl?: string | null }).exportUrl ?? null,
      autoAdvance: {
        enabled: episode.autorun,
        mode: autorunCfg.mode ?? (episode.autorun ? "batch" : null),
        moneyAuthorized: !!autorunCfg.moneyAuthorized,
      },
      project: {
        id: episode.project.id,
        name: episode.project.name,
        stylePackId: episode.project.stylePackId,
        videoRatio: episode.project.videoRatio,
      },
    },
    characters: charactersWithUrls.map((c) => ({
      ...c,
      activeTask: activeByKey.get(`IMAGE_CHARACTER:${(c as { id: string }).id}`) ?? null,
    })),
    locations: locationsWithUrls.map((l) => ({
      ...l,
      activeTask: activeByKey.get(`IMAGE_LOCATION:${(l as { id: string }).id}`) ?? null,
    })),
    shots: shotsWithUrls.map((sh) => ({
      ...sh,
      activeImageTask: activeByKey.get(`IMAGE_SHOT:${(sh as { id: string }).id}`) ?? null,
      activeVideoTask: activeByKey.get(`VIDEO_SHOT:${(sh as { id: string }).id}`) ?? null,
    })),
    voiceLines: voiceLinesWithUrls.map((v) => ({
      ...v,
      activeTask: activeByKey.get(`TTS_LINE:${(v as { id: string }).id}`) ?? null,
    })),
    stages: computeStages(snapshot),
    nextAction: computeNextAction(snapshot, episodeId),
    failedTasks,
    failedByStage: countByStage(failedTaskTypes),
    stuckTasks,
  };
}
