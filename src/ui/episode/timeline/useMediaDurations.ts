"use client";
// 舊資料 MediaObject.durationMs 係 null（worker 探測係後加嘅）——前端用
// loadedmetadata 量度補底，量到先入 map。同一個 key 只量一次。
import { useEffect, useRef, useState } from "react";

export interface DurationProbeItem {
  key: string; // line id / shot id
  url: string | null;
  kind: "audio" | "video";
}

export function useMediaDurations(items: DurationProbeItem[]): Record<string, number> {
  const [durations, setDurations] = useState<Record<string, number>>({});
  const requested = useRef(new Set<string>());

  useEffect(() => {
    for (const it of items) {
      if (!it.url || requested.current.has(it.key)) continue;
      requested.current.add(it.key);
      const el = document.createElement(it.kind);
      el.preload = "metadata";
      el.onloadedmetadata = () => {
        const ms = Math.round(el.duration * 1000);
        if (Number.isFinite(ms) && ms > 0) setDurations((d) => ({ ...d, [it.key]: ms }));
        el.removeAttribute("src");
      };
      el.onerror = () => {
        // 簽名 URL 過期等——下次 view 刷新會帶新 URL，屆時 key 已喺 requested，
        // 所以量唔到就放返出嚟俾佢重試
        requested.current.delete(it.key);
      };
      el.src = it.url;
    }
  }, [items]);

  return durations;
}
