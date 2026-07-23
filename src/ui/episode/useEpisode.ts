"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { episodeQuery, qk } from "@/ui/query-keys";
import type { LiveTaskMap, SseEvent, StageKey } from "@/ui/types";
import { TASK_TYPE_TO_STAGE } from "@/lib/task/stage-map";

const STALL_TIMEOUT_MS = 30_000;
const STALL_CHECK_INTERVAL_MS = 5_000;

export function useEpisode(episodeId: string) {
  const queryClient = useQueryClient();
  const query = useQuery(episodeQuery(episodeId));
  const [progress, setProgress] = useState<Partial<Record<StageKey, number>>>({});
  const [live, setLive] = useState<LiveTaskMap>({});
  const [stalled, setStalled] = useState(false);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const lastEventAtRef = useRef(Date.now());

  const view = query.data ?? null;
  const error = query.error ? query.error.message : null;

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
        if (targetKey)
          setLive((m) => {
            const { [targetKey]: _gone, ...rest } = m;
            return rest;
          });
        void queryClient.invalidateQueries({ queryKey: qk.episode(episodeId) });
      }
    };
    es.onerror = () => {
    };
    return () => es.close();
  }, [projectId, episodeId, queryClient, connectionEpoch]);

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

  const reconnect = async () => {
    await refetch();
    lastEventAtRef.current = Date.now();
    setStalled(false);
    setConnectionEpoch((n) => n + 1);
  };

  return { view, error, progress, live, refetch, stalled, reconnect };
}
