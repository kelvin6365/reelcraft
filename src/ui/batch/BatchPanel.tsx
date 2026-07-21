"use client";
// 批量出片（全季生成）面板：一鍵開批量 + 選項 modal + 停止掣 + 全季進度板。
// 後端見 POST/DELETE /api/projects/:id/batch（docs/plans/2026-07-19-batch-generation-design.md）。
// 進度板純由 episode.status + failedTasks 推導（輕量，跟住 project GET 輪詢刷新）。
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pause, Sparkles, TriangleAlert } from "lucide-react";
import { api, ApiClientError } from "@/ui/api";
import { qk } from "@/ui/query-keys";
import type { EpisodeListItem } from "@/ui/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  assets: "資產",
  script: "劇本",
  storyboard: "分鏡",
  images: "圖像",
  videos: "視頻",
  export: "成片",
  done: "已完成",
};

interface BatchOptions {
  autoConfirmStoryboard: boolean;
  skipVideo: boolean;
}

interface StartResult {
  started: number;
  skippedDone: number;
  config: BatchOptions;
  kicked: Record<string, string>;
}

// Chip state per episode, derived from the same status/autorun/failedTasks
// fields the old station-strip board used — presentation only, no new data.
type ChipState = "done" | "active" | "failed" | "pending";

function chipState(ep: EpisodeListItem): ChipState {
  if ((ep.failedTasks ?? 0) > 0) return "failed";
  if (ep.status === "done") return "done";
  if (ep.autorun) return "active";
  return "pending";
}

const CHIP_STYLE: Record<ChipState, string> = {
  done: "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400",
  active: "border-primary/40 bg-primary/10 text-primary",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
  pending: "border-border bg-secondary text-secondary-foreground",
};

function chipLabel(ep: EpisodeListItem, state: ChipState): string {
  if (state === "done") return "已完成";
  if (state === "failed") return `失敗 · ${ep.failedTasks}`;
  if (state === "active") return STATUS_LABEL[ep.status] ?? "生成中";
  return "排隊中";
}

export function BatchPanel({
  id,
  episodes,
}: {
  id: string;
  episodes: EpisodeListItem[];
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [opts, setOpts] = useState<BatchOptions>({ autoConfirmStoryboard: true, skipVideo: false });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const running = episodes.some((e) => e.autorun);

  // While a batch is running, keep the board fresh by re-polling the project.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void queryClient.invalidateQueries({ queryKey: qk.project(id) }), 5000);
    return () => clearInterval(t);
  }, [running, queryClient, id]);

  const startMutation = useMutation({
    mutationFn: () => api.post<StartResult>(`/api/projects/${id}/batch`, opts),
    onSuccess: async (res) => {
      setModalOpen(false);
      const skipped = res.skippedDone > 0 ? `（跳過 ${res.skippedDone} 集已完成）` : "";
      setMsg(`已開始批量生成 ${res.started} 集${skipped}`);
      await queryClient.invalidateQueries({ queryKey: qk.project(id) });
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => api.del<{ stopped: number }>(`/api/projects/${id}/batch`),
    onSuccess: async (res) => {
      setMsg(`已停止 ${res.stopped} 集的批量生成（進行中的任務會自然完成）`);
      await queryClient.invalidateQueries({ queryKey: qk.project(id) });
    },
  });

  const busy = startMutation.isPending || stopMutation.isPending;

  function start() {
    setErr(null);
    setMsg(null);
    startMutation.mutate(undefined, {
      onError: (e) => setErr((e as ApiClientError).message),
    });
  }

  function stop() {
    setErr(null);
    setMsg(null);
    stopMutation.mutate(undefined, {
      onError: (e) => setErr((e as ApiClientError).message),
    });
  }

  const total = episodes.length;
  const done = episodes.filter((e) => e.status === "done").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex-row items-center justify-between gap-3 border-b py-5">
        <div>
          <CardTitle>批量生成全季</CardTitle>
          <CardDescription className="mt-1">
            規劃好各集後一鍵全季自動出片，唔使逐集手動行八站。
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {running && (
            <Button variant="destructive" size="sm" onClick={stop} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Pause />}
              停止批量
            </Button>
          )}
          <Button size="sm" onClick={() => setModalOpen(true)} disabled={busy}>
            <Sparkles /> 批量生成
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 py-5">
        {msg && (
          <Alert>
            <AlertDescription>{msg}</AlertDescription>
          </Alert>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}

        {episodes.length > 0 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>整體進度</span>
                <span className="text-muted-foreground">{done} / {total} 集 · {pct}%</span>
              </div>
              <Progress value={pct} />
            </div>

            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
              {episodes.map((ep) => {
                const state = chipState(ep);
                return (
                  <div
                    key={ep.id}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-md border px-2 py-2.5",
                      CHIP_STYLE[state],
                    )}
                    title={`第 ${ep.episodeNumber} 集 · ${chipLabel(ep, state)}`}
                  >
                    <span className="text-sm font-semibold">EP{String(ep.episodeNumber).padStart(2, "0")}</span>
                    <span className="text-[11px]">{chipLabel(ep, state)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={modalOpen} onOpenChange={(o) => !busy && setModalOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>批量生成選項</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            資產（角色／場景）必須先鎖定先可以開始批量。未鎖會提示你返去揀圖。
          </p>

          <div className="space-y-4">
            <label className="flex items-start gap-3" htmlFor="batch-auto-storyboard">
              <Checkbox
                id="batch-auto-storyboard"
                checked={opts.autoConfirmStoryboard}
                onCheckedChange={(v) => setOpts((o) => ({ ...o, autoConfirmStoryboard: v === true }))}
              />
              <span className="text-sm">
                <span className="font-medium">自動確認分鏡</span>
                <span className="text-muted-foreground"> — 唔逐集停低等人手確認；關咗則每集停喺分鏡站亮燈等你。</span>
              </span>
            </label>

            <label className="flex items-start gap-3" htmlFor="batch-skip-video">
              <Checkbox
                id="batch-skip-video"
                checked={opts.skipVideo}
                onCheckedChange={(v) => setOpts((o) => ({ ...o, skipVideo: v === true }))}
              />
              <span className="text-sm">
                <span className="font-medium">跳過視頻（省錢模式）</span>
                <span className="text-muted-foreground"> — 圖像完成後直接配音→合成，用靜態圖出片，慳返視頻生成費。</span>
              </span>
            </label>
          </div>

          <Alert>
            <TriangleAlert />
            <AlertDescription>實際成本視乎你揀嘅模型而定；project 預算上限照樣把關。</AlertDescription>
          </Alert>

          {err && <p className="text-sm text-destructive">{err}</p>}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={busy}>
              取消
            </Button>
            <Button onClick={start} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              開始批量
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
