"use client";
// 預覽舞台：單一 <video>（鏡頭切換時換 src）或 <img>（純圖鏡），媒體元素被動
// 跟隨 usePreviewPlayback 嘅主時鐘。配音播放喺 useLineAudio（要 gesture prime，
// 唔可以擺呢度）。字幕係 HTML overlay 模擬——真字幕以成片為準。
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

  // CapCut 語義：字幕跟音嘅全局時間窗行，跨鏡繼續顯示（唔綁死喺所屬鏡）
  const activeSubtitles: TimelineChipModel[] = useMemo(
    () =>
      model.chips.filter(
        (c) => timeMs >= c.globalStartMs && timeMs < Math.min(c.globalStartMs + c.audioDurationMs, model.totalMs),
      ),
    [model, timeMs],
  );

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
