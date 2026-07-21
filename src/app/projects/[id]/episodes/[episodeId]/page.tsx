"use client";
import { use } from "react";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useEpisode } from "@/ui/episode/useEpisode";
import { PipelineBar } from "@/ui/episode/PipelineBar";
import { NextActionCard } from "@/ui/episode/NextActionCard";
import { FailureDrawer } from "@/ui/episode/FailureDrawer";
import { STATION_BY_KEY } from "@/ui/episode/stations";
import type { EpisodeView } from "@/ui/types";
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

export default function EpisodeWorkspacePage({
  params,
}: {
  params: Promise<{ id: string; episodeId: string }>;
}) {
  const { episodeId } = use(params);
  const { view, error, progress, live } = useEpisode(episodeId);

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
  const currentStation = STATION_BY_KEY[view.nextAction.stage];

  return (
    <AppShell
      active="projects"
      title={
        <span className="truncate">
          {episode.project.name} · 第 {episode.episodeNumber} 集
        </span>
      }
    >
      <div className="mx-auto max-w-[1400px] space-y-6 p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                {episode.project.name} · 第 {episode.episodeNumber} 集
              </h1>
              <Badge variant="outline">{episode.status}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              八站工作流 · 目前喺第 {currentStation.index} 站（{currentStation.name}）· {view.nextAction.label}
            </p>
          </div>
        </div>

        <PipelineBar stages={view.stages} progress={progress} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-6">
            <InputPanel view={view} progress={progress} />
            <AssetsPanel view={view} progress={progress} live={live} />
            <ScriptPanel view={view} progress={progress} />
            <StoryboardPanel view={view} progress={progress} />
            <ImagesPanel view={view} progress={progress} live={live} />
            <VideosPanel view={view} progress={progress} live={live} />
            <VoicePanel view={view} progress={progress} />
            <ExportPanel view={view} progress={progress} />
          </div>

          <div className="space-y-6 self-start lg:sticky lg:top-20">
            <NextActionCard nextAction={view.nextAction} episodeId={episodeId} />
            <CostCard view={view} />
          </div>
        </div>
      </div>

      <FailureDrawer episodeId={episodeId} failedCount={view.failedTasks} />
    </AppShell>
  );
}

function CostRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function CostCard({ view }: { view: EpisodeView }) {
  const cost = view.cost;
  const downstream = cost?.downstream ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">成本</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <CostRow label="本專案已使" value={cost ? `$${cost.projectSpendUsd.toFixed(2)}` : "—"} />
        {downstream && downstream.totalUsd > 0 && (
          <>
            <Separator />
            <CostRow label={`待生成圖像 ${downstream.pendingImages} 張`} value={`~$${downstream.estImageUsd.toFixed(2)}`} />
            <CostRow label={`待生成視頻 ${downstream.pendingVideos} 鏡`} value={`~$${downstream.estVideoUsd.toFixed(2)}`} />
            {downstream.videoUnitUsd ? <CostRow label="每鏡視頻單價" value={`$${downstream.videoUnitUsd.toFixed(2)}`} /> : null}
            <Separator />
            <CostRow label="下游預估小計" value={`~$${downstream.totalUsd.toFixed(2)}`} />
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
