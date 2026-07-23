"use client";
import { use, useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useEpisode } from "@/ui/episode/useEpisode";
import { PipelineBar } from "@/ui/episode/PipelineBar";
import { NextActionCard } from "@/ui/episode/NextActionCard";
import { FailureDrawer } from "@/ui/episode/FailureDrawer";
import { STATIONS, STATION_BY_KEY } from "@/ui/episode/stations";
import { statusLabel, statusVariant } from "@/ui/episode/status";
import { StationNavProvider } from "@/ui/episode/station-nav";
import type { EpisodeView, StageKey } from "@/ui/types";
import {
  InputPanel,
  AssetsPanel,
  ScriptPanel,
  StoryboardPanel,
  ImagesPanel,
  VideosPanel,
  VoicePanel,
  ExportPanel,
} from "@/ui/episode/panels";

const PANEL_BY_STAGE = {
  input: InputPanel,
  assets: AssetsPanel,
  script: ScriptPanel,
  storyboard: StoryboardPanel,
  images: ImagesPanel,
  videos: VideosPanel,
  voice: VoicePanel,
  export: ExportPanel,
} as const;

const isStageKey = (v: string | null): v is StageKey => !!v && v in PANEL_BY_STAGE;

export default function EpisodeWorkspacePage({
  params,
}: {
  params: Promise<{ id: string; episodeId: string }>;
}) {
  const { episodeId } = use(params);
  const { view, error, progress, live, stalled, reconnect } = useEpisode(episodeId);
  const [station, setStation] = useState<StageKey | null>(null);
  const [failuresOpen, setFailuresOpen] = useState(false);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("station");
    if (isStageKey(fromUrl)) setStation(fromUrl);
  }, []);

  const selectStation = useCallback((key: StageKey) => {
    setStation(key);
    const url = new URL(window.location.href);
    url.searchParams.set("station", key);
    window.history.replaceState(null, "", url);
  }, []);

  if (error && !view) {
    return (
      <AppShell active="projects" title="工作區">
        <div className="p-8">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </AppShell>
    );
  }
  if (!view) {
    return (
      <AppShell active="projects" title="工作區">
        <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">載入中…</div>
      </AppShell>
    );
  }

  const { episode } = view;
  const current = station ?? view.nextAction.stage;
  const meta = STATION_BY_KEY[current];
  const Panel = PANEL_BY_STAGE[current];
  const pos = STATIONS.findIndex((s) => s.key === current);
  const prev = pos > 0 ? STATIONS[pos - 1] : null;
  const next = pos < STATIONS.length - 1 ? STATIONS[pos + 1] : null;

  return (
    <AppShell
      active="projects"
      title={
        <span className="truncate">
          {episode.project.name} · 第 {episode.episodeNumber} 集
        </span>
      }
    >
      <StationNavProvider value={selectStation}>
      <div className="mx-auto max-w-[1400px] space-y-6 p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                {episode.project.name} · 第 {episode.episodeNumber} 集
              </h1>
              <Badge variant={statusVariant(episode.status)}>{statusLabel(episode.status)}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              八站工作流 · 睇緊第 {meta.index} 站（{meta.name}）· 下一步：{view.nextAction.label}
            </p>
          </div>
        </div>

        <PipelineBar
          stages={view.stages}
          progress={progress}
          failedByStage={view.failedByStage}
          current={current}
          onSelect={selectStation}
          notice={
            stalled ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                <span>連線可能中斷，資料可能唔係最新 — 重新整理</span>
                <Button variant="outline" size="sm" onClick={() => void reconnect()}>
                  重新整理
                </Button>
              </div>
            ) : null
          }
        />

        {}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="order-last min-w-0 space-y-6 lg:order-none">
            <Panel view={view} progress={progress} live={live} />

            <div className="flex items-center justify-between gap-3">
              {prev ? (
                <Button variant="ghost" onClick={() => selectStation(prev.key)}>
                  <ChevronLeft /> 第 {prev.index} 站 · {prev.name}
                </Button>
              ) : (
                <span />
              )}
              {next ? (
                <Button variant="ghost" onClick={() => selectStation(next.key)}>
                  第 {next.index} 站 · {next.name} <ChevronRight />
                </Button>
              ) : (
                <span />
              )}
            </div>
          </div>

          <div className="order-first space-y-6 self-start lg:order-none lg:sticky lg:top-20">
            <NextActionCard
              nextAction={{ ...view.nextAction, estCostUsd: stageEstCostUsd(view) }}
              episodeId={episodeId}
              pendingUnits={stagePendingUnits(view)}
            />
            <CostCard view={view} />
            {view.failedTasks > 0 && (
              <Card className="border-destructive/40">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base text-destructive">
                    <AlertTriangle className="size-4" /> 失敗任務 {view.failedTasks}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" className="w-full" onClick={() => setFailuresOpen(true)}>
                    查看並重試
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      <FailureDrawer episodeId={episodeId} open={failuresOpen} onOpenChange={setFailuresOpen} />
      </StationNavProvider>
    </AppShell>
  );
}

function stageEstCostUsd(view: EpisodeView): number | undefined {
  const downstream = view.cost?.downstream;
  if (!downstream) return undefined;
  if (view.nextAction.stage === "images" && downstream.estImageUsd > 0) return downstream.estImageUsd;
  if (view.nextAction.stage === "videos" && downstream.estVideoUsd > 0) return downstream.estVideoUsd;
  return undefined;
}

function stagePendingUnits(view: EpisodeView): number | undefined {
  const downstream = view.cost?.downstream;
  if (!downstream) return undefined;
  if (view.nextAction.stage === "images") return downstream.pendingImages;
  if (view.nextAction.stage === "videos") return downstream.pendingVideos;
  return undefined;
}

function CostRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={strong ? "font-medium" : "text-muted-foreground"}>{label}</span>
      <span className={strong ? "font-medium tabular-nums" : "tabular-nums"}>{value}</span>
    </div>
  );
}

function CostCard({ view }: { view: EpisodeView }) {
  const cost = view.cost;
  const downstream = cost?.downstream ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">本集計費</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {}
        <CostRow label="本集已使" value={cost ? `$${cost.episodeSpendUsd.toFixed(2)}` : "—"} strong />
        <CostRow label="本專案已使" value={cost ? `$${cost.projectSpendUsd.toFixed(2)}` : "—"} />
        {downstream && downstream.totalUsd > 0 && (
          <>
            <Separator />
            <CostRow label={`待生成圖像 ${downstream.pendingImages} 張`} value={`~$${downstream.estImageUsd.toFixed(2)}`} />
            <CostRow label={`待生成視頻 ${downstream.pendingVideos} 鏡`} value={`~$${downstream.estVideoUsd.toFixed(2)}`} />
            {downstream.videoUnitUsd ? <CostRow label="每鏡視頻單價" value={`$${downstream.videoUnitUsd.toFixed(2)}`} /> : null}
            <Separator />
            <CostRow label="下游預估小計" value={`~$${downstream.totalUsd.toFixed(2)}`} strong />
          </>
        )}
        {cost?.activeModels && (
          <>
            <Separator />
            <CostRow label="圖像模型" value={cost.activeModels.image.modelKey.split("::").pop() ?? "—"} />
            <CostRow label="視頻模型" value={cost.activeModels.video.modelKey.split("::").pop() ?? "—"} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
