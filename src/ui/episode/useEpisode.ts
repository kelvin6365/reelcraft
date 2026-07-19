"use client";
// Loads the aggregate episode view and keeps it fresh from the SSE progress
// stream. COMPLETED/FAILED events trigger a debounced refetch; PROGRESS events
// feed a per-stage "生成中 x%" indicator.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiClientError } from "@/ui/api";
import type { EpisodeView, LiveTaskMap, SseEvent, StageKey } from "@/ui/types";

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
  const [view, setView] = useState<EpisodeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Partial<Record<StageKey, number>>>({});
  // per-target in-flight state (`${taskType}:${targetId}`) — drives per-cell
  // "生成中 x%" indicators and button locking in the media grids
  const [live, setLive] = useState<LiveTaskMap>({});

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    try {
      const v = await api.get<EpisodeView>(`/api/episodes/${episodeId}`);
      setView(v);
      setError(null);
    } catch (e) {
      setError((e as ApiClientError).message);
    }
  }, [episodeId]);

  const debouncedRefetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void refetch(), 500);
  }, [refetch]);

  // initial load
  useEffect(() => {
    void refetch();
  }, [refetch]);

  // SSE — subscribe once we know the projectId
  const projectId = view?.episode.projectId;
  useEffect(() => {
    if (!projectId) return;
    const es = new EventSource(`/api/sse?projectId=${projectId}`);
    es.onmessage = (msg) => {
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
        // Failures surface via the failure drawer (refetch below) — just unlock the cell.
        if (targetKey)
          setLive((m) => {
            const { [targetKey]: _gone, ...rest } = m;
            return rest;
          });
        debouncedRefetch();
      }
    };
    es.onerror = () => {
      /* browser auto-reconnects EventSource */
    };
    return () => es.close();
  }, [projectId, debouncedRefetch]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return { view, error, progress, live, refetch };
}
