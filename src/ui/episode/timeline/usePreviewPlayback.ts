"use client";
// 預覽播放主時鐘：rAF 錨住 performance.now()，媒體元素跟時鐘走（唔係反過嚟）。
// 去到結尾自動停；seek 時純粹改時間，媒體同步交返俾 PreviewStage 嘅 effect。
import { useCallback, useEffect, useRef, useState } from "react";

export interface PreviewPlayback {
  timeMs: number;
  playing: boolean;
  toggle: () => void;
  seek: (ms: number) => void;
}

export function usePreviewPlayback(totalMs: number): PreviewPlayback {
  const [playing, setPlaying] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const anchor = useRef({ wall: 0, media: 0 });
  const raf = useRef(0);

  useEffect(() => {
    if (!playing) return;
    anchor.current = { wall: performance.now(), media: timeMs };
    const tick = () => {
      const t = anchor.current.media + (performance.now() - anchor.current.wall);
      if (t >= totalMs) {
        setTimeMs(totalMs);
        setPlaying(false);
        return;
      }
      setTimeMs(t);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // timeMs 只喺開播嗰下做錨點，唔應該令 effect 重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, totalMs]);

  const toggle = useCallback(() => {
    setPlaying((p) => {
      if (!p && timeMs >= totalMs) setTimeMs(0); // 完咗再撳 = 由頭播
      return !p;
    });
  }, [timeMs, totalMs]);

  const seek = useCallback(
    (ms: number) => {
      const clamped = Math.max(0, Math.min(totalMs, ms));
      setTimeMs(clamped);
      anchor.current = { wall: performance.now(), media: clamped };
    },
    [totalMs],
  );

  return { timeMs, playing, toggle, seek };
}
