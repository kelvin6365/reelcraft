"use client";
// Loads the aggregate episode view via TanStack Query and keeps it fresh from
// the SSE progress stream. COMPLETED/FAILED events invalidate the episode query
// (TanStack dedupes concurrent refetches, so no manual debounce needed);
// PROGRESS events feed a per-stage "生成中 x%" indicator kept as local state —
// ephemeral UI state, deliberately outside the query cache.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { episodeQuery, qk } from "@/ui/query-keys";
import type { LiveTaskMap, SseEvent, StageKey } from "@/ui/types";

// If no SSE event lands within this window while a task is active, the
// connection is probably stuck (proxy/network hiccup) — surface a warning
// rather than silently showing stale progress.
const STALL_TIMEOUT_MS = 30_000;
const STALL_CHECK_INTERVAL_MS = 5_000;

const TASK_TYPE_TO_STAGE: Record<string, StageKey> = {
  REWRITE_SCRIPT: "script",
  EXTRACT_ASSETS: "assets",
  IMAGE_CHARACTER: "assets",
  IMAGE_LOCATION: "assets",
  BUILD_SCENES: "storyboard",
  STORYBOARD_RUN: "storyboard",
  IMAGE_SHOT: "images",
  VIDEO_SHOT: "videos",
  VOICE_ANALYZE: "voice",
  TTS_LINE: "voice",
  COMPOSE_EPISODE: "export",
};

export function useEpisode(episodeId: string) {
  const queryClient = useQueryClient();
  const query = useQuery(episodeQuery(episodeId));
  const [progress, setProgress] = useState<Partial<Record<StageKey, number>>>({});
  // per-target in-flight state (`${taskType}:${targetId}`) — drives per-cell
  // "生成中 x%" indicators and button locking in the media grids
  const [live, setLive] = useState<LiveTaskMap>({});
  const [stalled, setStalled] = useState(false);
  // bump to force the SSE effect below to tear down and reconnect
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const lastEventAtRef = useRef(Date.now());

  const view = query.data ?? null;
  const error = query.error ? query.error.message : null;

  // SSE — subscribe once we know the projectId
  const projectId = view?.episode.projectId;
  useEffect(() => {
    if (!projectId) return;
    lastEventAtRef.current = Date.now();
    setStalled(false);
    const es = new EventSource(`/api/sse?projectId=${projectId}`);
    es.onmessage = (msg) => {
      lastEventAtRef.current = Date.now();
      setStalled(false);
      let ev: SseEvent;
      try {
        ev = JSON.parse(msg.data) as SseEvent;
      } catch {
        return;
      }
      const stage = TASK_TYPE_TO_STAGE[ev.taskType];
      const targetKey = ev.targetId ? `${ev.taskType}:${ev.targetId}` : null;
      if (ev.eventType === "PROGRESS" && stage) {
        setProgress((p) => ({ ...p, [stage]: Math.round(ev.progress ?? 0) }));
        if (targetKey) setLive((m) => ({ ...m, [targetKey]: { progress: Math.round(ev.progress ?? 0) } }));
      } else if (ev.eventType === "CREATED" || ev.eventType === "PROCESSING" || ev.eventType === "RETRYING") {
        if (targetKey) setLive((m) => ({ ...m, [targetKey]: { progress: m[targetKey]?.progress } }));
      } else if (ev.eventType === "COMPLETED" || ev.eventType === "FAILED") {
        if (stage) setProgress((p) => ({ ...p, [stage]: undefined }));
        // Failures surface via the failure drawer (invalidation below) — just unlock the cell.
        if (targetKey)
          setLive((m) => {
            const { [targetKey]: _gone, ...rest } = m;
            return rest;
          });
        void queryClient.invalidateQueries({ queryKey: qk.episode(episodeId) });
      }
    };
    es.onerror = () => {
      /* browser auto-reconnects EventSource */
    };
    return () => es.close();
  }, [projectId, episodeId, queryClient, connectionEpoch]);

  // Poll for staleness: only meaningful while something is actually in flight
  // (a live target cell or a per-stage progress percentage).
  useEffect(() => {
    const hasActiveTask = Object.keys(live).length > 0 || Object.values(progress).some((v) => v !== undefined);
    if (!hasActiveTask) {
      setStalled(false);
      return;
    }
    const t = setInterval(() => {
      if (Date.now() - lastEventAtRef.current > STALL_TIMEOUT_MS) setStalled(true);
    }, STALL_CHECK_INTERVAL_MS);
    return () => clearInterval(t);
  }, [live, progress]);

  const refetch = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.episode(episodeId) });
  };

  // Refetch the episode data and force the SSE connection to be recreated —
  // exposed for the "連線可能中斷" warning's 重新整理 action.
  const reconnect = async () => {
    await refetch();
    lastEventAtRef.current = Date.now();
    setStalled(false);
    setConnectionEpoch((n) => n + 1);
  };

  return { view, error, progress, live, refetch, stalled, reconnect };
}
