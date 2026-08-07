"use client";
// View → 時間軸模型。chip 擺位一定要行 placeLines（同 worker 合成共用嘅單一真相），
// 唔准喺 UI 度另計一套。
import { useMemo } from "react";
import { placeLinesPadded } from "@/lib/timeline/placement";
import type { EpisodeView, ShotView, VoiceLineView } from "@/ui/types";

export const FALLBACK_SHOT_MS = 3000;
export const FALLBACK_AUDIO_MS = 2000;

export interface TimelineShotModel {
  shot: ShotView;
  startMs: number; // 全集時間軸上嘅起點
  durationMs: number; // 補時後長度（= clipMs + padMs）——行寬／播放窗全部用呢個
  clipMs: number; // 原 clip 長度
  padMs: number; // 凍幀延長咗幾多（合成時 tpad；純圖鏡係直接 render 長啲）
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
  dead: boolean; // 成句都喺鏡尾之後——合成完全唔會出聲，預覽照樣靜音
  row: number; // 配音行內嘅堆疊行——時間上重疊嘅 chip 落唔同行，唔准疊埋
}

export interface TimelineModel {
  shots: TimelineShotModel[];
  chips: TimelineChipModel[];
  unmatched: VoiceLineView[]; // 有音但未綁鏡——喺托盤度俾人拖入去
  totalMs: number;
  laneRows: number; // 配音行要幾多層先冇重疊
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
  const visualIds = new Set(withVisual.map((s) => s.id));

  const audioLines = view.voiceLines.filter((v) => v.audioUrl);
  const effective = (v: VoiceLineView) => ({
    matchedShotId: overrides[v.id]?.matchedShotId !== undefined ? overrides[v.id].matchedShotId : v.matchedShotId,
    offsetMs: overrides[v.id]?.offsetMs !== undefined ? overrides[v.id].offsetMs : v.offsetMs,
  });

  // 單一 pass：鏡長 = 補時後長度（依賴該鏡啲 chip），所以擺位同鏡頭要一齊行
  let cursor = 0;
  const shots: TimelineShotModel[] = [];
  const chips: TimelineChipModel[] = [];
  for (const shot of withVisual) {
    const clipMs = shotDuration(shot, measured);
    const lines = audioLines
      .map((v) => ({ v, eff: effective(v) }))
      .filter(({ eff }) => eff.matchedShotId === shot.id);
    const { placed, paddedMs, padMs } = placeLinesPadded(
      lines.map(({ v, eff }) => ({
        id: v.id,
        lineIndex: v.lineIndex,
        offsetMs: eff.offsetMs,
        audioDurationMs: v.audioDurationMs ?? measured[v.id] ?? FALLBACK_AUDIO_MS,
      })),
      clipMs,
    );
    const s: TimelineShotModel = { shot, startMs: cursor, durationMs: paddedMs, clipMs, padMs, hasVisual: true };
    cursor += paddedMs;
    shots.push(s);

    const byId = new Map(placed.map((p) => [p.lineId, p]));
    for (const { v } of lines) {
      const p = byId.get(v.id)!;
      chips.push({
        line: v,
        shotId: shot.id,
        localStartMs: p.startMs,
        localEndMs: p.endMs,
        globalStartMs: s.startMs + p.startMs,
        audioDurationMs: p.endMs - p.startMs,
        overflow: p.truncatedAtMs !== null,
        dead: p.startMs >= paddedMs,
        row: 0, // 下面統一做 interval stacking
      });
    }
  }
  const unmatched: VoiceLineView[] = [];
  for (const v of audioLines) {
    const eff = effective(v);
    if (!eff.matchedShotId || !visualIds.has(eff.matchedShotId)) unmatched.push(v);
  }

  // Interval stacking：時間上重疊嘅 chip 落唔同行（greedy——搵第一行結尾唔阻住佢嘅）。
  // chip 闊度以「全局起點 + 真音長」計，即係會伸出鏡尾，所以要跨鏡一齊排。
  const rowEnds: number[] = [];
  for (const chip of [...chips].sort((a, b) => a.globalStartMs - b.globalStartMs)) {
    const end = chip.globalStartMs + chip.audioDurationMs;
    let row = rowEnds.findIndex((e) => e <= chip.globalStartMs);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(end);
    } else {
      rowEnds[row] = end;
    }
    chip.row = row;
  }

  return { shots, chips, unmatched, totalMs: cursor, laneRows: Math.max(1, rowEnds.length) };
}

export function useTimelineModel(
  view: EpisodeView,
  measured: Record<string, number>,
  overrides: Record<string, { offsetMs: number | null; matchedShotId: string | null }>,
): TimelineModel {
  return useMemo(() => buildTimelineModel(view, measured, overrides), [view, measured, overrides]);
}
