"use client";
// 成片時間軸編輯器：合成前預覽 + 配音 chip 拖拉。所有擺位行 placeLines
//（同 worker 合成共用），所以拖完見到嘅位置就係合成出嚟嘅位置。
import { useMemo, useRef, useState } from "react";
import { Pause, Play, ZoomIn, ZoomOut } from "lucide-react";
import { api } from "@/ui/api";
import { useAction } from "@/ui/planning/useAction";
import { qk } from "@/ui/query-keys";
import type { EpisodeView, VoiceLineView } from "@/ui/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AudioChip, type ChipCommit } from "./AudioChip";
import { PreviewStage } from "./PreviewStage";
import { useMediaDurations, type DurationProbeItem } from "./useMediaDurations";
import { usePreviewPlayback } from "./usePreviewPlayback";
import { useTimelineModel } from "./useTimelineModel";

const ZOOMS = [24, 48, 96]; // px / 秒

export function TimelineEditor({ view }: { view: EpisodeView }) {
  const { busy, err, run } = useAction(qk.episode(view.episode.id));
  const laneRef = useRef<HTMLDivElement>(null);
  const [zoomIdx, setZoomIdx] = useState(1);
  const [announce, setAnnounce] = useState("");
  const [overrides, setOverrides] = useState<Record<string, { offsetMs: number | null; matchedShotId: string | null }>>({});
  const pxPerSec = ZOOMS[zoomIdx];

  // 量度冇 durationMs 嘅舊媒體（worker 探測係後加嘅）
  const probeItems = useMemo<DurationProbeItem[]>(
    () => [
      ...view.voiceLines.filter((v) => v.audioUrl && v.audioDurationMs == null).map((v) => ({ key: v.id, url: v.audioUrl, kind: "audio" as const })),
      ...view.shots.filter((s) => s.videoUrl && s.videoDurationMs == null).map((s) => ({ key: s.id, url: s.videoUrl, kind: "video" as const })),
    ],
    [view],
  );
  const measured = useMediaDurations(probeItems);

  const model = useTimelineModel(view, measured, overrides);
  const playback = usePreviewPlayback(model.totalMs);

  const msToPx = (ms: number) => (ms / 1000) * pxPerSec;

  const previewChip = (lineId: string, next: { offsetMs: number; matchedShotId: string }) =>
    setOverrides((o) => ({ ...o, [lineId]: next }));

  const commitChip = (lineId: string, next: ChipCommit) => {
    const target = next.matchedShotId ?? model.chips.find((c) => c.line.id === lineId)?.shotId ?? null;
    setOverrides((o) => ({ ...o, [lineId]: { offsetMs: next.offsetMs, matchedShotId: target } }));
    void run(() => api.patch(`/api/voice-lines/${lineId}`, next)).then((okay) => {
      // 失敗就撤銷本地覆蓋（snap back），錯誤文案由 err 渲染
      if (!okay) setOverrides((o) => { const { [lineId]: _, ...rest } = o; return rest; });
    });
  };

  if (model.shots.length === 0) return null;

  const totalSec = Math.ceil(model.totalMs / 1000);

  return (
    <section aria-label="成片時間軸" className="space-y-3">
      <PreviewStage model={model} timeMs={playback.timeMs} playing={playback.playing} videoRatio={view.episode.project.videoRatio} />

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={playback.toggle} aria-label={playback.playing ? "暫停預覽" : "播放預覽"}>
          {playback.playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {(playback.timeMs / 1000).toFixed(1)}s / {(model.totalMs / 1000).toFixed(1)}s
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" disabled={zoomIdx === 0} onClick={() => setZoomIdx((z) => z - 1)} aria-label="縮細時間軸">
            <ZoomOut className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" disabled={zoomIdx === ZOOMS.length - 1} onClick={() => setZoomIdx((z) => z + 1)} aria-label="放大時間軸">
            <ZoomIn className="size-4" />
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <div ref={laneRef} className="relative" style={{ width: msToPx(model.totalMs) + 1, minWidth: "100%" }}>
          {/* 尺：撳邊度 seek 邊度 */}
          <div
            className="relative h-6 cursor-pointer border-b bg-muted/40"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              playback.seek(((e.clientX - rect.left) / pxPerSec) * 1000);
            }}
            role="slider"
            aria-label="預覽時間位置"
            aria-valuemin={0}
            aria-valuemax={Math.round(model.totalMs / 1000)}
            aria-valuenow={Math.round(playback.timeMs / 1000)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") playback.seek(playback.timeMs - 1000);
              if (e.key === "ArrowRight") playback.seek(playback.timeMs + 1000);
            }}
          >
            {Array.from({ length: totalSec + 1 }, (_, s) => (
              <span
                key={s}
                className={cn("absolute bottom-0 border-l border-border", s % 5 === 0 ? "h-4" : "h-2")}
                style={{ left: msToPx(s * 1000) }}
              >
                {s % 5 === 0 && <span className="absolute -top-0.5 left-0.5 text-[10px] text-muted-foreground tabular-nums">{s}s</span>}
              </span>
            ))}
          </div>

          {/* 鏡頭行 */}
          <div className="relative flex h-14 border-b bg-background">
            {model.shots.map((s) => (
              <div
                key={s.shot.id}
                className="relative shrink-0 overflow-hidden border-r bg-muted/20"
                style={{ width: msToPx(s.durationMs) }}
                title={`第 ${s.shot.shotIndex + 1} 鏡 · ${(s.durationMs / 1000).toFixed(1)}s`}
              >
                {s.shot.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.shot.imageUrl} alt="" className="size-full object-cover opacity-60" />
                )}
                <span className="absolute top-0.5 left-1 rounded bg-black/50 px-1 text-[10px] text-white tabular-nums">
                  {s.shot.shotIndex + 1}
                </span>
              </div>
            ))}
          </div>

          {/* 配音行 */}
          <div className="relative h-10 bg-background">
            {model.chips.map((chip) => (
              <AudioChip
                key={chip.line.id}
                chip={chip}
                shots={model.shots}
                pxPerSec={pxPerSec}
                laneEl={() => laneRef.current}
                busy={busy}
                onPreview={previewChip}
                onCommit={commitChip}
                onAnnounce={setAnnounce}
              />
            ))}
          </div>

          {/* 播放頭 */}
          <div className="pointer-events-none absolute inset-y-0 w-px bg-primary" style={{ left: msToPx(playback.timeMs) }} aria-hidden />
        </div>
      </div>

      {model.unmatched.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">未綁定鏡頭嘅配音——撳一下就放入第 1 鏡開頭，之後喺時間軸再拖去啱嘅位：</p>
          <div className="flex flex-wrap gap-1.5">
            {model.unmatched.map((v) => (
              <UnmatchedChip key={v.id} line={v} model={model} busy={busy} onCommit={commitChip} onAnnounce={setAnnounce} />
            ))}
          </div>
        </div>
      )}

      {err && <p className="text-sm text-destructive">{err}</p>}
      <p className="text-xs text-muted-foreground">模擬預覽，同成片可能有輕微出入（字幕字體、鏡頭銜接、音量以成片為準）。</p>
      <span aria-live="polite" className="sr-only">
        {announce}
      </span>
    </section>
  );
}

// 未綁定嘅配音：一撳循環指派落下一個鏡（第 1 鏡開始），offset 0——之後再喺
// 時間軸慢慢執位。刻意行簡單路線，唔同 AudioChip 嗰套拖拉重複。
function UnmatchedChip({
  line,
  model,
  busy,
  onCommit,
  onAnnounce,
}: {
  line: VoiceLineView;
  model: ReturnType<typeof useTimelineModel>;
  busy: boolean;
  onCommit: (lineId: string, next: ChipCommit) => void;
  onAnnounce: (text: string) => void;
}) {
  const first = model.shots[0];
  if (!first) return null;
  return (
    <button
      type="button"
      disabled={busy}
      aria-busy={busy}
      className="rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground hover:bg-accent/40"
      onClick={() => {
        onCommit(line.id, { offsetMs: 0, matchedShotId: first.shot.id });
        onAnnounce(`已將「${line.content}」放入第 ${first.shot.shotIndex + 1} 鏡開頭`);
      }}
    >
      {line.speaker || "旁白"}：{line.content}
    </button>
  );
}
