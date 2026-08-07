"use client";
// View → 時間軸模型。chip 擺位一定要行 placeLines（同 worker 合成共用嘅單一真相），
// 唔准喺 UI 度另計一套。
import { useMemo } from "react";
import { placeLines } from "@/lib/timeline/placement";
import type { EpisodeView, ShotView, VoiceLineView } from "@/ui/types";

export const FALLBACK_SHOT_MS = 3000;
export const FALLBACK_AUDIO_MS = 2000;

export interface TimelineShotModel {
  shot: ShotView;
  startMs: number; // 全集時間軸上嘅起點
  durationMs: number;
  hasVisual: boolean;
}

export interface TimelineChipModel {
  line: VoiceLineView;
  shotId: string;
  localStartMs: number; // 相對所屬鏡頭
  localEndMs: number;
  globalStartMs: number;
  audioDurationMs: number;
  overflow: boolean; // 超出鏡尾，合成時會被截
}

export interface TimelineModel {
  shots: TimelineShotModel[];
  chips: TimelineChipModel[];
  unmatched: VoiceLineView[]; // 有音但未綁鏡——喺托盤度俾人拖入去
  totalMs: number;
}

export function shotDuration(shot: ShotView, measured: Record<string, number>): number {
  return shot.videoDurationMs ?? measured[shot.id] ?? (shot.durationMs || FALLBACK_SHOT_MS);
}

export function buildTimelineModel(
  view: EpisodeView,
  measured: Record<string, number>,
  // 拖緊／啱啱 commit 未 refetch 嘅本地覆蓋：lineId → { offsetMs, matchedShotId }
  overrides: Record<string, { offsetMs: number | null; matchedShotId: string | null }>,
): TimelineModel {
  const withVisual = view.shots.filter((s) => s.videoUrl || s.imageUrl);
  let cursor = 0;
  const shots: TimelineShotModel[] = withVisual.map((shot) => {
    const durationMs = shotDuration(shot, measured);
    const m = { shot, startMs: cursor, durationMs, hasVisual: true };
    cursor += durationMs;
    return m;
  });
  const shotById = new Map(shots.map((s) => [s.shot.id, s]));

  const audioLines = view.voiceLines.filter((v) => v.audioUrl);
  const effective = (v: VoiceLineView) => ({
    matchedShotId: overrides[v.id]?.matchedShotId !== undefined ? overrides[v.id].matchedShotId : v.matchedShotId,
    offsetMs: overrides[v.id]?.offsetMs !== undefined ? overrides[v.id].offsetMs : v.offsetMs,
  });

  const chips: TimelineChipModel[] = [];
  const unmatched: VoiceLineView[] = [];
  for (const s of shots) {
    const lines = audioLines
      .map((v) => ({ v, eff: effective(v) }))
      .filter(({ eff }) => eff.matchedShotId === s.shot.id);
    const placed = placeLines(
      lines.map(({ v, eff }) => ({
        id: v.id,
        lineIndex: v.lineIndex,
        offsetMs: eff.offsetMs,
        audioDurationMs: v.audioDurationMs ?? measured[v.id] ?? FALLBACK_AUDIO_MS,
      })),
      s.durationMs,
    );
    const byId = new Map(placed.map((p) => [p.lineId, p]));
    for (const { v } of lines) {
      const p = byId.get(v.id)!;
      chips.push({
        line: v,
        shotId: s.shot.id,
        localStartMs: p.startMs,
        localEndMs: p.endMs,
        globalStartMs: s.startMs + p.startMs,
        audioDurationMs: p.endMs - p.startMs,
        overflow: p.truncatedAtMs !== null,
      });
    }
  }
  for (const v of audioLines) {
    const eff = effective(v);
    if (!eff.matchedShotId || !shotById.has(eff.matchedShotId)) unmatched.push(v);
  }

  return { shots, chips, unmatched, totalMs: cursor };
}

export function useTimelineModel(
  view: EpisodeView,
  measured: Record<string, number>,
  overrides: Record<string, { offsetMs: number | null; matchedShotId: string | null }>,
): TimelineModel {
  return useMemo(() => buildTimelineModel(view, measured, overrides), [view, measured, overrides]);
}
