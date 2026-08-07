"use client";
// 預覽舞台：單一 <video>（鏡頭切換時換 src）或 <img>（純圖鏡），媒體元素被動
// 跟隨 usePreviewPlayback 嘅主時鐘；每句配音一個 Audio 物件，入窗即播、出窗即停,
// 鏡尾強制停（同合成 atrim 語義一致）。字幕係 HTML overlay 模擬——真字幕以成片為準。
import { useEffect, useMemo, useRef } from "react";
import { api } from "@/ui/api";
import type { TimelineChipModel, TimelineModel } from "./useTimelineModel";

const DRIFT_TOLERANCE_MS = 150;

// 簽名 URL 一個鐘過期——媒體元素報錯就問 /api/media/[id]/url 攞新 URL，只重試一次
async function refreshUrl(mediaId: string | null): Promise<string | null> {
  if (!mediaId) return null;
  try {
    const { url } = await api.get<{ url: string }>(`/api/media/${mediaId}/url`);
    return url;
  } catch {
    return null;
  }
}

interface Props {
  model: TimelineModel;
  timeMs: number;
  playing: boolean;
  videoRatio: string;
}

export function PreviewStage({ model, timeMs, playing, videoRatio }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRefs = useRef(new Map<string, HTMLAudioElement>());
  const refreshedOnce = useRef(new Set<string>());

  const active = useMemo(() => {
    for (const s of model.shots) {
      if (timeMs < s.startMs + s.durationMs) return s;
    }
    return model.shots[model.shots.length - 1] ?? null;
  }, [model, timeMs]);

  const localMs = active ? timeMs - active.startMs : 0;

  // 視頻同步：換鏡換 src；播/停跟時鐘；漂移過閾值先 seek（避免逐幀狂 seek）
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !active?.shot.videoUrl) return;
    // src 對唔對唔靠 URL 內容判斷——用 dataset 記鏡頭 id
    if (el.dataset.shotId !== active.shot.id) {
      el.dataset.shotId = active.shot.id;
      el.src = active.shot.videoUrl;
    }
    if (Math.abs(el.currentTime * 1000 - localMs) > DRIFT_TOLERANCE_MS) {
      el.currentTime = localMs / 1000;
    }
    if (playing && el.paused) void el.play().catch(() => {});
    if (!playing && !el.paused) el.pause();
  }, [active, localMs, playing]);

  // 配音同步：入窗即播（seek 到窗內位置）、出窗／過鏡尾即停
  useEffect(() => {
    for (const chip of model.chips) {
      const shot = model.shots.find((s) => s.shot.id === chip.shotId);
      if (!shot || !chip.line.audioUrl) continue;
      let el = audioRefs.current.get(chip.line.id);
      if (!el) {
        el = new Audio();
        el.preload = "auto";
        el.src = chip.line.audioUrl;
        el.onerror = () => {
          if (refreshedOnce.current.has(chip.line.id)) return;
          refreshedOnce.current.add(chip.line.id);
          void refreshUrl(chip.line.audioMediaId).then((url) => {
            if (url && el) el.src = url;
          });
        };
        audioRefs.current.set(chip.line.id, el);
      }
      const start = chip.globalStartMs;
      // 鏡尾截斷：有效結尾 = min(句尾, 鏡尾)——同合成 atrim 一致
      const end = Math.min(start + chip.audioDurationMs, shot.startMs + shot.durationMs);
      const inWindow = playing && timeMs >= start && timeMs < end;
      if (inWindow) {
        const local = (timeMs - start) / 1000;
        if (Math.abs(el.currentTime - local) > DRIFT_TOLERANCE_MS / 1000) el.currentTime = local;
        if (el.paused) void el.play().catch(() => {});
      } else if (!el.paused) {
        el.pause();
      }
    }
  }, [model, timeMs, playing]);

  // 卸載時全部收聲
  useEffect(() => {
    const refs = audioRefs.current;
    return () => {
      for (const el of refs.values()) el.pause();
    };
  }, []);

  // 視頻 src 過期重試（一次）
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !active) return;
    const onErr = () => {
      if (refreshedOnce.current.has(active.shot.id)) return;
      refreshedOnce.current.add(active.shot.id);
      void refreshUrl(active.shot.videoMediaId).then((url) => {
        if (url && videoRef.current) videoRef.current.src = url;
      });
    };
    el.addEventListener("error", onErr);
    return () => el.removeEventListener("error", onErr);
  }, [active]);

  const activeSubtitles: TimelineChipModel[] = useMemo(() => {
    if (!active) return [];
    const shotEnd = active.startMs + active.durationMs;
    return model.chips.filter(
      (c) => c.shotId === active.shot.id && timeMs >= c.globalStartMs && timeMs < Math.min(c.globalStartMs + c.audioDurationMs, shotEnd),
    );
  }, [model, active, timeMs]);

  const portrait = videoRatio !== "16:9";
  return (
    <div className={`relative mx-auto overflow-hidden rounded-lg bg-black ${portrait ? "aspect-9/16 max-h-96" : "aspect-video w-full max-w-160"}`}>
      {active?.shot.videoUrl ? (
        <video ref={videoRef} muted playsInline className="size-full object-contain" aria-label={`第 ${active.shot.shotIndex + 1} 鏡預覽`} />
      ) : active?.shot.imageUrl ? (
        // 純圖鏡：靜止畫面停留成個鏡長（合成時同樣係 imageToVideoClip 靜止）
        // eslint-disable-next-line @next/next/no-img-element
        <img src={active.shot.imageUrl} alt={`第 ${active.shot.shotIndex + 1} 鏡分鏡圖`} className="size-full object-contain" />
      ) : (
        <div className="flex size-full items-center justify-center text-sm text-white/60">冇畫面</div>
      )}
      {activeSubtitles.length > 0 && (
        <div className="pointer-events-none absolute inset-x-4 bottom-[8%] text-center">
          {activeSubtitles.map((c) => (
            <p key={c.line.id} className="text-sm font-medium text-white [text-shadow:0_0_4px_rgba(0,0,0,0.9)]">
              {c.line.content}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
