import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api/errors";
import { computeNextAction, computeStages, type EpisodeSnapshot } from "@/lib/next-action";
import { attachMediaUrls } from "@/lib/media/service";
import { ACTIVE_STATUSES } from "@/lib/task/types";
import { countByStage } from "@/lib/task/stage-map";
import { activeFailures } from "@/lib/task/superseded";
import { humanizeTaskError } from "@/lib/task/error-copy";
import { resolveModelDefaults } from "@/lib/model-defaults/resolve";
import { effectiveImageModelKey } from "@/lib/ai/generate-media";
import { getCapabilities } from "@/lib/ai/capabilities";

const CONFIRMED_STATUSES = ["images", "videos", "export", "done"];

export interface PropTerminalTask {
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  finishedAt: Date | null;
}

export interface PropTerminalTaskRow {
  type: string;
  targetId: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  queuedAt: Date | string;
  finishedAt: Date | string | null;
}

// 由一批 project-scoped terminal task（IMAGE_PROP／VIDEO_PROP 混埋）計返每件道具嘅
// 「目前未解決嘅失敗」。重用 activeFailures（同 FailureDrawer 嘅 unresolvedFailures
// 一致嘅邏輯）——一個 (type, targetId) 嘅失敗如果之後有更新嘅同型 task 成功咗就唔算
// 數（例如 VIDEO_PROP 完成咗唔應該蓋住一個仍未解決嘅 IMAGE_PROP 失敗，反之亦然）。
// 一件道具可能同時有 IMAGE_PROP 同 VIDEO_PROP 兩個未解決失敗，卡片顯示揀最新嗰個。
// Pure（唔碰 DB）方便單元測試。
export function pickPropLastError(tasks: PropTerminalTaskRow[]): Record<string, PropTerminalTask> {
  const unresolved = activeFailures(
    tasks.filter((t) => t.status === "failed"),
    tasks.filter((t) => t.status === "completed"),
  );
  const latest: Record<string, PropTerminalTask> = {};
  for (const t of unresolved) {
    const time = new Date(t.finishedAt ?? t.queuedAt).getTime();
    const prev = latest[t.targetId];
    if (!prev || time > new Date(prev.finishedAt ?? 0).getTime()) {
      latest[t.targetId] = { status: t.status, errorCode: t.errorCode, errorMessage: t.errorMessage, finishedAt: t.finishedAt ? new Date(t.finishedAt) : null };
    }
  }
  return latest;
}

export async function buildEpisodeSnapshot(
  episode: { id: string; projectId: string; rawText: string; scriptText: string; status: string; exportMediaId: string | null },
  inputType: string,
): Promise<{ snapshot: EpisodeSnapshot; characters: Awaited<ReturnType<typeof prisma.character.findMany>>; locations: Awaited<ReturnType<typeof prisma.location.findMany>>; props: Awaited<ReturnType<typeof prisma.prop.findMany>>; propLatestTerminal: Record<string, PropTerminalTask>; shots: Awaited<ReturnType<typeof prisma.shot.findMany>>; voiceLines: Awaited<ReturnType<typeof prisma.voiceLine.findMany>>; activeTasks: { id: string; type: string; targetId: string; status: string; progress: number; queuedAt: Date; heartbeatAt: Date | null }[]; failedTaskTypes: string[] }> {
  const episodeId = episode.id;
  const [characters, locations, props, scenes, shots, voiceLines, activeTasks, terminalTasks, propTerminalTasks] = await Promise.all([
    // id is UUID v7 (time-ordered) → creation/extraction order. Without an
    // orderBy, Postgres reorders rows after UPDATEs (lock/regen), making the
    // asset cards jump around in the UI.
    prisma.character.findMany({ where: { projectId: episode.projectId }, orderBy: { id: "asc" } }),
    prisma.location.findMany({ where: { projectId: episode.projectId }, orderBy: { id: "asc" } }),
    // 唔屬於 autorun 資產 gate（手動觸發），但同一個 project-level 資產庫，UI 需要一齊顯示。
    prisma.prop.findMany({ where: { projectId: episode.projectId }, orderBy: { id: "asc" } }),
    prisma.scene.count({ where: { episodeId } }),
    prisma.shot.findMany({ where: { episodeId }, orderBy: { shotIndex: "asc" } }),
    prisma.voiceLine.findMany({ where: { episodeId }, orderBy: { lineIndex: "asc" } }),
    prisma.task.findMany({ where: { episodeId, status: { in: ACTIVE_STATUSES } }, select: { id: true, type: true, targetId: true, status: true, progress: true, queuedAt: true, heartbeatAt: true } }),
    prisma.task.findMany({
      where: { episodeId, status: { in: ["failed", "completed"] } },
      select: { type: true, targetId: true, status: true, queuedAt: true, finishedAt: true },
    }),
    // Prop 生圖 task（IMAGE_PROP／VIDEO_PROP）同 Location/Character 一致，唔綁 episodeId
    // 只綁 projectId（project-level 資產）——上面嗰條 episodeId-scoped terminalTasks
    // 永遠攞唔到道具嘅失敗記錄，要獨立一條 projectId-scoped query。
    prisma.task.findMany({
      where: { projectId: episode.projectId, targetType: "prop", status: { in: ["failed", "completed"] } },
      select: { type: true, targetId: true, status: true, errorCode: true, errorMessage: true, queuedAt: true, finishedAt: true },
    }),
  ]);

  const propLatestTerminal = pickPropLastError(propTerminalTasks);

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
  return { snapshot, characters, locations, props, propLatestTerminal, shots, voiceLines, activeTasks, failedTaskTypes: unresolvedFailures.map((t) => t.type) };
}

export async function buildEpisodeView(userId: string, episodeId: string) {
  const episode = await prisma.episode.findFirst({
    where: { id: episodeId, userId },
    include: { project: true },
  });
  if (!episode) throw new ApiError("NOT_FOUND", 404, "episode not found");

  const { snapshot, characters, locations, props, propLatestTerminal, shots, voiceLines, activeTasks, failedTaskTypes } = await buildEpisodeSnapshot(episode, episode.project.inputType);
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

  const [charactersWithUrls, locationsWithUrls, propsWithUrls, shotsWithUrls, voiceLinesWithUrls, episodeWithUrl] = await Promise.all([
    attachMediaUrls(characters, ["lockedImageMediaId", "faceImageMediaId", "refFaceMediaId"]),
    attachMediaUrls(locations, ["lockedImageMediaId"]),
    attachMediaUrls(props, ["lockedImageMediaId", "refVideoMediaId"]),
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
  type LocationAngle = { label: string; prompt: string; mediaId: string | null; reason?: string };
  const allCandidateIds = [
    ...characters.flatMap((c) => c.candidates as string[]),
    ...characters.flatMap((c) => (c.views as LocationAngle[]).map((v) => v.mediaId).filter((id): id is string => !!id)),
    ...locations.flatMap((l) => l.candidates as string[]),
    ...locations.flatMap((l) => (l.angles as LocationAngle[]).map((a) => a.mediaId).filter((id): id is string => !!id)),
    ...props.flatMap((p) => p.candidates as string[]),
    ...props.flatMap((p) => (p.views as LocationAngle[]).map((v) => v.mediaId).filter((id): id is string => !!id)),
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
      views: ((c as { views: unknown }).views as LocationAngle[]).map((v) => ({
        ...v,
        url: v.mediaId ? (candidateUrlById[v.mediaId] ?? null) : null,
      })),
    })),
    locations: locationsWithUrls.map((l) => ({
      ...l,
      activeTask: activeByKey.get(`IMAGE_LOCATION:${(l as { id: string }).id}`) ?? null,
      angles: ((l as { angles: unknown }).angles as LocationAngle[]).map((a) => ({
        ...a,
        url: a.mediaId ? (candidateUrlById[a.mediaId] ?? null) : null,
      })),
    })),
    props: propsWithUrls.map((p) => {
      const id = (p as { id: string }).id;
      const terminal = propLatestTerminal[id];
      const lastError =
        terminal && terminal.status === "failed"
          ? {
              code: terminal.errorCode,
              message: terminal.errorMessage,
              humanized: humanizeTaskError(terminal.errorCode, terminal.errorMessage).message,
              failedAt: terminal.finishedAt ? terminal.finishedAt.toISOString() : null,
            }
          : null;
      return {
        ...p,
        activeTask: activeByKey.get(`IMAGE_PROP:${id}`) ?? activeByKey.get(`VIDEO_PROP:${id}`) ?? null,
        lastError,
        views: ((p as { views: unknown }).views as LocationAngle[]).map((v) => ({
          ...v,
          url: v.mediaId ? (candidateUrlById[v.mediaId] ?? null) : null,
        })),
      };
    }),
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
