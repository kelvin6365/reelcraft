"use client";
// 配音播放池。關鍵：瀏覽器 autoplay 政策只認 user gesture 嗰刻嘅 activation——
// 播放中途先 lazy create + play() 嘅 Audio 會被 block（條片有 muted 所以照播，
// 就出現「有畫面冇聲」）。所以撳「播放」嗰下要即刻 prime() 晒成池：逐粒静音
// play+pause 解鎖，之後 rAF 時鐘去到窗口先真播。
import { useCallback, useEffect, useRef } from "react";
import { api } from "@/ui/api";
import type { TimelineModel } from "./useTimelineModel";

const DRIFT_TOLERANCE_S = 0.15;

async function refreshUrl(mediaId: string | null): Promise<string | null> {
  if (!mediaId) return null;
  try {
    const { url } = await api.get<{ url: string }>(`/api/media/${mediaId}/url`);
    return url;
  } catch {
    return null;
  }
}

export function useLineAudio(
  model: TimelineModel,
  timeMs: number,
  playing: boolean,
  // 播放池載入到 metadata 就回報真時長——DB 冇 durationMs 嘅舊音靠呢度修正
  // 2 秒 fallback，唔會再「當佢短咗、播一半收聲」
  onDuration?: (lineId: string, ms: number) => void,
): { prime: () => void } {
  const pool = useRef(new Map<string, HTMLAudioElement>());
  const refreshedOnce = useRef(new Set<string>());

  const ensure = useCallback(
    (lineId: string): HTMLAudioElement | null => {
      const chip = model.chips.find((c) => c.line.id === lineId);
      if (!chip?.line.audioUrl) return null;
      let el = pool.current.get(lineId);
      if (!el) {
        el = new Audio();
        el.preload = "auto";
        el.src = chip.line.audioUrl;
        el.onloadedmetadata = () => {
          const ms = Math.round((el?.duration ?? 0) * 1000);
          if (Number.isFinite(ms) && ms > 0) onDuration?.(lineId, ms);
        };
        el.onerror = () => {
          if (refreshedOnce.current.has(lineId)) return;
          refreshedOnce.current.add(lineId);
          void refreshUrl(chip.line.audioMediaId).then((url) => {
            const cached = pool.current.get(lineId);
            if (url && cached) cached.src = url;
          });
        };
        pool.current.set(lineId, el);
      }
      return el;
    },
    [model, onDuration],
  );

  // 一定要喺 user gesture handler 入面同步call（撳播放嗰下）
  const prime = useCallback(() => {
    for (const chip of model.chips) {
      const el = ensure(chip.line.id);
      if (!el || el.dataset.primed) continue;
      el.dataset.primed = "1";
      el.muted = true;
      void el
        .play()
        .then(() => {
          el.pause();
          el.currentTime = 0;
          el.muted = false;
        })
        .catch(() => {
          el.muted = false;
        });
    }
  }, [model, ensure]);

  // 時鐘同步：入窗即播（seek 到窗內位置）。CapCut 語義——音獨立於鏡頭切換，
  // 跨鏡照播，只有成集結尾先會截（同合成最終 pass 嘅 atrim 一致）
  useEffect(() => {
    for (const chip of model.chips) {
      const el = pool.current.get(chip.line.id) ?? (playing ? ensure(chip.line.id) : null);
      if (!el) continue;
      const start = chip.globalStartMs;
      const end = Math.min(start + chip.audioDurationMs, model.totalMs);
      const inWindow = playing && timeMs >= start && timeMs < end;
      if (inWindow) {
        const local = (timeMs - start) / 1000;
        // metadata 未載到（readyState 0）就唔好 seek——部分瀏覽器會出 InvalidState
        if (el.readyState >= 1 && Math.abs(el.currentTime - local) > DRIFT_TOLERANCE_S) el.currentTime = local;
        if (el.paused) void el.play().catch(() => {});
      } else if (!el.paused) {
        el.pause();
      }
    }
  }, [model, timeMs, playing, ensure]);

  // 卸載收聲
  useEffect(() => {
    const p = pool.current;
    return () => {
      for (const el of p.values()) el.pause();
    };
  }, []);

  return { prime };
}
