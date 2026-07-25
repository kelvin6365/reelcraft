"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
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
import { api } from "@/ui/api";
import { useAction } from "@/ui/planning/useAction";
import { qk } from "@/ui/query-keys";
import { statusLabel, statusVariant } from "@/ui/episode/status";
import { StationNavProvider } from "@/ui/episode/station-nav";
import { shortModelName } from "@/ui/model-format";
import { formatUsdDisplay } from "@/ui/episode/cost-confirm";
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
          <Link href={`/projects/${episode.projectId}`} className="hover:underline">
            {episode.project.name}
          </Link>{" "}
          · 第 {episode.episodeNumber} 集
        </span>
      }
    >
      <StationNavProvider value={selectStation}>
      <div className="mx-auto max-w-[1400px] space-y-6 p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                <Link href={`/projects/${episode.projectId}`} className="hover:underline">
                  {episode.project.name}
                </Link>{" "}
                · 第 {episode.episodeNumber} 集
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
              suppressButton={current === view.nextAction.stage && isStageEmpty(view, current)}
            />
            <CostCard view={view} />
            {view.stuckTasks > 0 && <StuckTasksCard episodeId={episodeId} count={view.stuckTasks} />}
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

// 3 mirrors ASSET_CANDIDATE_COUNT in src/lib/billing/quote.ts — each pending
// character/location gets 3 candidate images generated in one batch.
const ASSET_CANDIDATE_COUNT = 3;

function isStageEmpty(view: EpisodeView, stage: StageKey): boolean {
  switch (stage) {
    case "script":
      return view.episode.scriptText.length === 0;
    case "assets":
      return view.characters.length + view.locations.length === 0;
    case "storyboard":
    case "images":
    case "videos":
      return view.shots.length === 0;
    case "voice":
      return view.voiceLines.length === 0;
    case "export":
      return !view.episode.exportUrl;
    default:
      return false;
  }
}

function stageEstCostUsd(view: EpisodeView): number | undefined {
  const downstream = view.cost?.downstream;
  if (view.nextAction.stage === "images" && downstream && downstream.estImageUsd > 0) return downstream.estImageUsd;
  if (view.nextAction.stage === "videos" && downstream && downstream.estVideoUsd > 0) return downstream.estVideoUsd;
  if (view.nextAction.stage === "assets") {
    const units = stagePendingUnits(view);
    const unit = view.cost?.activeModels?.image.unitUsd;
    if (!units || typeof unit !== "number") return undefined;
    return units * ASSET_CANDIDATE_COUNT * unit;
  }
  return undefined;
}

function stagePendingUnits(view: EpisodeView): number | undefined {
  const downstream = view.cost?.downstream;
  if (view.nextAction.stage === "images") return downstream?.pendingImages;
  if (view.nextAction.stage === "videos") return downstream?.pendingVideos;
  if (view.nextAction.stage === "assets") {
    return (
      view.characters.filter((c) => c.candidates.length === 0 && !c.locked).length +
      view.locations.filter((l) => l.candidates.length === 0 && !l.locked).length
    );
  }
  return undefined;
}

// Shown when tasks have sat queued past ~60s with no worker consuming them —
// the "stuck on 生成中 forever" case. One click re-enqueues the orphaned jobs.
function StuckTasksCard({ episodeId, count }: { episodeId: string; count: number }) {
  const { busy, err, run } = useAction(qk.episode(episodeId));
  const [done, setDone] = useState(false);
  return (
    <Card className="border-amber-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-amber-600 dark:text-amber-400">
          <AlertTriangle className="size-4" /> {count} 個任務卡住
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          任務排咗隊但冇喺處理 —— 通常係 worker 未運行（dev 要開 <code>npm run worker</code>）。重新排隊會叫返佢哋跑。
        </p>
        <Button
          variant="outline"
          className="w-full"
          disabled={busy}
          aria-busy={busy}
          onClick={() =>
            void run(() => api.post(`/api/episodes/${episodeId}/recover-stuck`)).then((ok) => setDone(ok))
          }
        >
          {busy ? (
            <>
              <Loader2 className="animate-spin" /> 重新排隊中…
            </>
          ) : (
            "重新排隊卡住任務"
          )}
        </Button>
        {done && !busy && !err && <p className="text-xs text-muted-foreground">已重新排隊，留意上方進度。</p>}
        {err && <p className="text-sm text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}

function CostRow({
  label,
  value,
  strong,
  title,
}: {
  label: string;
  value: string;
  strong?: boolean;
  title?: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={strong ? "font-medium" : "text-muted-foreground"}>{label}</span>
      <span className={strong ? "font-medium tabular-nums" : "tabular-nums"} title={title}>
        {value}
      </span>
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
        <CostRow label="本集已使" value={cost ? formatUsdDisplay(cost.episodeSpendUsd) : "—"} strong />
        <CostRow label="本專案已使" value={cost ? formatUsdDisplay(cost.projectSpendUsd) : "—"} />
        {downstream && downstream.totalUsd > 0 && (
          <>
            <Separator />
            <CostRow
              label={`待生成圖像 ${downstream.pendingImages} 張`}
              value={"~" + formatUsdDisplay(downstream.estImageUsd)}
            />
            <CostRow
              label={`待生成視頻 ${downstream.pendingVideos} 鏡`}
              value={"~" + formatUsdDisplay(downstream.estVideoUsd)}
            />
            {downstream.videoUnitUsd ? (
              <CostRow label="每鏡視頻單價" value={formatUsdDisplay(downstream.videoUnitUsd)} />
            ) : null}
            <Separator />
            <CostRow label="下游預估小計" value={"~" + formatUsdDisplay(downstream.totalUsd)} strong />
          </>
        )}
        {cost?.activeModels && (
          <>
            <Separator />
            <CostRow
              label="圖像模型"
              value={shortModelName(cost.activeModels.image.modelKey)}
              title={cost.activeModels.image.modelKey}
            />
            <CostRow
              label="視頻模型"
              value={shortModelName(cost.activeModels.video.modelKey)}
              title={cost.activeModels.video.modelKey}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
