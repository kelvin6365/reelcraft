// Batch auto-advance engine (docs/plans/2026-07-19-batch-generation-design.md).
// Reuses computeNextAction as the driver: on every completed task, figure out the
// episode's next step and submit it — until the episode is done or hits a human
// gate. Idempotent (task dedupeKeys) and safe to re-kick any time.
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { buildEpisodeSnapshot } from "@/lib/api/episode-snapshot";
import { computeNextAction, type EpisodeSnapshot } from "@/lib/next-action";
import { submitTask } from "@/lib/task/submit";
import { TASK_TYPE } from "@/lib/task/types";
import { submitVoiceLineBatch } from "@/lib/api/voice-batch";

export interface AutorunConfig {
  autoConfirmStoryboard?: boolean;
  skipVideo?: boolean;
  // Assisted auto-advance (docs/plans/...): engine runs FREE stages automatically
  // but stops at money stages until the user authorizes spend. Absent mode
  // MUST behave exactly like today's batch engine — existing DB rows only have
  // autoConfirmStoryboard/skipVideo.
  mode?: "batch" | "assisted";
  moneyAuthorized?: boolean;
}

function configOf(v: unknown): AutorunConfig {
  return (v ?? {}) as AutorunConfig;
}

// Advance one autorun episode by one step. Returns what it did (for tests/logs).
export async function advanceEpisode(episodeId: string): Promise<string> {
  const episode = await prisma.episode.findUnique({ where: { id: episodeId }, include: { project: true } });
  if (!episode || !episode.autorun) return "not-autorun";
  const cfg = configOf(episode.autorunConfig);
  const assisted = cfg.mode === "assisted";
  const userId = episode.userId;
  const projectId = episode.projectId;

  const { snapshot: raw } = await buildEpisodeSnapshot(episode, episode.project.inputType);
  // skipVideo (省錢模式): pretend all shots already have video so the state
  // machine flows images → voice → compose (compose falls back to still clips).
  const snapshot: EpisodeSnapshot = cfg.skipVideo
    ? { ...raw, shots: { ...raw.shots, withVideo: raw.shots.total } }
    : raw;

  const action = computeNextAction(snapshot, episodeId);
  if (action.busy) return "busy";

  // Payload {at: 0} is deliberately deterministic (unlike the UI routes'
  // {at: Date.now()}): concurrent advance calls for the same step then collide
  // on dedupeKey instead of double-submitting.
  const ep = { userId, projectId, episodeId };
  const submitEp = (type: (typeof TASK_TYPE)[keyof typeof TASK_TYPE], payload: Record<string, unknown> = {}) =>
    submitTask({ ...ep, type, targetType: "episode", targetId: episodeId, payload });

  switch (true) {
    case action.label === "已完成 🎬 可下載成片": {
      await prisma.episode.update({ where: { id: episodeId }, data: { autorun: false } });
      audit(userId, "batch.episode-done", { targetType: "episode", targetId: episodeId, source: "system" });
      return "done";
    }
    case action.endpoint?.endsWith("/rewrite-script") ?? false: {
      await submitEp(TASK_TYPE.REWRITE_SCRIPT, { at: 0 });
      return "rewrite-script";
    }
    case action.endpoint?.endsWith("/extract-assets") ?? false: {
      await submitEp(TASK_TYPE.EXTRACT_ASSETS, { at: 0 });
      return "extract-assets";
    }
    case action.endpoint?.endsWith("/generate-asset-images") ?? false: {
      if (assisted) return "paused:asset-images"; // checkpoint 1 — user clicks the costed button; 揀圖 stop is the existing paused:lock-assets gate
      const [chars, locs] = await Promise.all([
        prisma.character.findMany({ where: { projectId, locked: false } }),
        prisma.location.findMany({ where: { projectId, locked: false } }),
      ]);
      let n = 0;
      for (const c of chars) {
        if ((c.candidates as string[]).length > 0) continue;
        await submitTask({ ...ep, type: TASK_TYPE.IMAGE_CHARACTER, targetType: "character", targetId: c.id, payload: { at: 0 } });
        n++;
      }
      for (const l of locs) {
        if ((l.candidates as string[]).length > 0) continue;
        await submitTask({ ...ep, type: TASK_TYPE.IMAGE_LOCATION, targetType: "location", targetId: l.id, payload: { at: 0 } });
        n++;
      }
      return n > 0 ? `asset-images:${n}` : "paused:lock-assets"; // candidates ready → human gate
    }
    case action.stage === "assets" && action.endpoint === null:
      return "paused:lock-assets"; // 3-choose-1 is a human gate — batch waits here
    case action.endpoint?.endsWith("/storyboard") ?? false: {
      await submitEp(TASK_TYPE.BUILD_SCENES, { at: 0, then: TASK_TYPE.STORYBOARD_RUN });
      return "storyboard";
    }
    case action.endpoint?.endsWith("/srt-build") ?? false: {
      await submitEp(TASK_TYPE.SRT_BUILD, { at: 0 });
      return "srt-build";
    }
    case action.stage === "storyboard" && action.endpoint === null: {
      if (!cfg.autoConfirmStoryboard) return "paused:confirm-storyboard";
      await prisma.episode.update({ where: { id: episodeId }, data: { status: "images" } });
      audit(userId, "storyboard.confirm", { targetType: "episode", targetId: episodeId, source: "system", metadata: { batch: true } });
      return advanceEpisode(episodeId); // gate passed — advance again immediately
    }
    case action.endpoint?.endsWith("/generate-shot-images") ?? false: {
      if (assisted && !cfg.moneyAuthorized) return "paused:money";
      const shots = await prisma.shot.findMany({ where: { episodeId, imageMediaId: null } });
      for (const s of shots) await submitTask({ ...ep, type: TASK_TYPE.IMAGE_SHOT, targetType: "shot", targetId: s.id, payload: { at: 0 } });
      return `shot-images:${shots.length}`;
    }
    case action.endpoint?.endsWith("/generate-shot-videos") ?? false: {
      if (assisted && !cfg.moneyAuthorized) return "paused:money";
      const shots = await prisma.shot.findMany({ where: { episodeId, videoMediaId: null, imageMediaId: { not: null } } });
      for (const s of shots) await submitTask({ ...ep, type: TASK_TYPE.VIDEO_SHOT, targetType: "shot", targetId: s.id, payload: { at: 0 } });
      return `shot-videos:${shots.length}`;
    }
    case action.endpoint?.endsWith("/voice") ?? false: {
      await submitEp(TASK_TYPE.VOICE_ANALYZE, { at: 0 });
      return "voice-analyze";
    }
    // 未派晒音色（endpoint null）。AI 派音係純 text call，唔使錢生成音頻，
    // 所以 autorun 自動行一次；行完仍然未派晒（模型漏人／音色庫唔夾）就停低
    // 等人揀 —— 硬行落去只會成集同一把預設聲。
    case action.stage === "voice" && action.endpoint === null && !action.busy: {
      const tried = await prisma.task.count({
        where: { episodeId, type: TASK_TYPE.VOICE_CAST, status: { in: ["completed", "failed"] } },
      });
      if (tried > 0) return "paused:voice-cast";
      await submitEp(TASK_TYPE.VOICE_CAST, { at: 0 });
      return "voice-cast";
    }
    case action.endpoint?.endsWith("/tts-all") ?? false: {
      if (assisted && !cfg.moneyAuthorized) return "paused:money";
      // 行返 API 同一個 helper —— 空台詞／未派音色嘅行要剔走，唔好排一堆
      // 注定失敗嘅 task 出嚟。
      const { submitted } = await submitVoiceLineBatch({ userId, episode, lineIds: null });
      return `tts:${submitted}`;
    }
    case action.endpoint?.endsWith("/compose") ?? false: {
      await submitEp(TASK_TYPE.COMPOSE_EPISODE, { at: 0 });
      return "compose";
    }
    default:
      return `no-op:${action.stage}`;
  }
}

// Lifecycle hook: called (fire-and-forget) after any task with an episodeId
// completes. Never throws into the caller.
export function advanceAfterTask(episodeId: string | null): void {
  if (!episodeId) return;
  void advanceEpisode(episodeId).catch((err) =>
    console.error("[batch] advance failed", { episodeId, err: String(err) }),
  );
}
