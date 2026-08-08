"use client";
// 一句配音一粒 chip。拖拉用 pointer capture（同 media-lightbox 嘅手法，唔引 DnD 庫）：
// 橫拖改 offset、拖過另一個鏡嘅範圍就換鏡；放手先 commit（一個手勢一個 PATCH）。
// 鍵盤：←→ ±100ms、Shift ±1s、[ ] 搬去前／後一個鏡。
import { useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TimelineChipModel, TimelineShotModel } from "./useTimelineModel";

export interface ChipCommit {
  offsetMs: number | null;
  matchedShotId?: string;
}

interface Props {
  chip: TimelineChipModel;
  shots: TimelineShotModel[];
  pxPerSec: number;
  laneEl: () => HTMLDivElement | null;
  busy: boolean;
  onPreview: (lineId: string, next: { offsetMs: number; matchedShotId: string }) => void;
  onCommit: (lineId: string, next: ChipCommit) => void;
  onAnnounce: (text: string) => void;
}

const KEY_STEP_MS = 100;
const KEY_STEP_BIG_MS = 1000;

export function AudioChip({ chip, shots, pxPerSec, laneEl, busy, onPreview, onCommit, onAnnounce }: Props) {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointerId: number; grabOffsetPx: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const msToPx = (ms: number) => (ms / 1000) * pxPerSec;
  const shot = shots.find((s) => s.shot.id === chip.shotId);
  if (!shot) return null;

  const leftPx = msToPx(chip.globalStartMs);
  const widthPx = Math.max(24, msToPx(chip.audioDurationMs));

  // pointer x（相對 lane）→ 邊個鏡 + 鏡內 offset
  const locate = (clientX: number, grabOffsetPx: number): { shotId: string; offsetMs: number } | null => {
    const lane = laneEl();
    if (!lane) return null;
    const x = clientX - lane.getBoundingClientRect().left - grabOffsetPx;
    const globalMs = Math.max(0, (x / pxPerSec) * 1000);
    for (const s of shots) {
      if (globalMs < s.startMs + s.durationMs || s === shots[shots.length - 1]) {
        return { shotId: s.shot.id, offsetMs: Math.max(0, Math.round(globalMs - s.startMs)) };
      }
    }
    return null;
  };

  const label = `${chip.line.speaker || "旁白"}：${chip.line.content}`;

  const commitKeyNudge = (offsetMs: number) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onCommit(chip.line.id, { offsetMs }), 400);
  };

  return (
    <button
      type="button"
      aria-busy={busy}
      aria-label={`${label}，第 ${shot.shot.shotIndex + 1} 鏡，${(chip.localStartMs / 1000).toFixed(1)} 秒${chip.dead ? "，完全超出成集結尾唔會出聲" : chip.overflow ? "，去到成集結尾會被截" : ""}`}
      title={
        chip.dead
          ? "呢句成句都喺成集結尾之後——合成唔會出聲，拖返前啲先有效"
          : chip.overflow
            ? "呢句去到成集結尾都未播完，尾段會被截"
            : label
      }
      className={cn(
        "absolute flex h-8 cursor-grab touch-none items-center gap-1 overflow-hidden rounded-md border px-1.5 text-xs select-none",
        chip.dead
          ? "border-destructive/70 bg-destructive/15 text-destructive line-through"
          : chip.overflow
            ? "border-amber-500/70 bg-amber-500/20 text-amber-900 dark:text-amber-200"
            : "border-primary/50 bg-primary/15 text-foreground",
        dragging && "z-10 cursor-grabbing ring-2 ring-primary",
        busy && "opacity-60",
      )}
      style={{ left: leftPx, width: widthPx, top: 4 + chip.row * 36 }}
      onPointerDown={(e) => {
        if (busy) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const rect = e.currentTarget.getBoundingClientRect();
        drag.current = { pointerId: e.pointerId, grabOffsetPx: e.clientX - rect.left };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!drag.current || e.pointerId !== drag.current.pointerId) return;
        const next = locate(e.clientX, drag.current.grabOffsetPx);
        if (next) onPreview(chip.line.id, { offsetMs: next.offsetMs, matchedShotId: next.shotId });
      }}
      onPointerUp={(e) => {
        if (!drag.current || e.pointerId !== drag.current.pointerId) return;
        const next = locate(e.clientX, drag.current.grabOffsetPx);
        drag.current = null;
        setDragging(false);
        if (next) {
          const moved = next.shotId !== chip.shotId;
          onCommit(chip.line.id, moved ? { offsetMs: next.offsetMs, matchedShotId: next.shotId } : { offsetMs: next.offsetMs });
          const target = shots.find((s) => s.shot.id === next.shotId);
          onAnnounce(`已搬到第 ${(target?.shot.shotIndex ?? 0) + 1} 鏡 ${(next.offsetMs / 1000).toFixed(1)} 秒`);
        }
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
        onPreview(chip.line.id, { offsetMs: chip.localStartMs, matchedShotId: chip.shotId });
      }}
      onKeyDown={(e) => {
        if (busy) return;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const step = (e.shiftKey ? KEY_STEP_BIG_MS : KEY_STEP_MS) * (e.key === "ArrowLeft" ? -1 : 1);
          const offsetMs = Math.max(0, chip.localStartMs + step);
          onPreview(chip.line.id, { offsetMs, matchedShotId: chip.shotId });
          commitKeyNudge(offsetMs);
          onAnnounce(`${(offsetMs / 1000).toFixed(1)} 秒`);
        } else if (e.key === "[" || e.key === "]") {
          e.preventDefault();
          const idx = shots.findIndex((s) => s.shot.id === chip.shotId);
          const target = shots[idx + (e.key === "[" ? -1 : 1)];
          if (target) {
            onCommit(chip.line.id, { offsetMs: chip.localStartMs, matchedShotId: target.shot.id });
            onAnnounce(`已搬到第 ${target.shot.shotIndex + 1} 鏡`);
          }
        }
      }}
    >
      {chip.overflow && <AlertTriangle className="size-3 shrink-0" aria-hidden />}
      <span className="truncate">{chip.line.content}</span>
    </button>
  );
}
