"use client";
import { use } from "react";
import { TopBar } from "@/ui/TopBar";
import { useEpisode } from "@/ui/episode/useEpisode";
import { PipelineBar } from "@/ui/episode/PipelineBar";
import { NextActionCard } from "@/ui/episode/NextActionCard";
import { FailureDrawer } from "@/ui/episode/FailureDrawer";
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
  const { view, error, progress, live, refetch } = useEpisode(episodeId);

  if (error && !view) {
    return (
      <>
        <TopBar />
        <main className="container page-pad">
          <p className="error-text">{error}</p>
        </main>
      </>
    );
  }
  if (!view) return <div className="center-screen">載入中…</div>;

  const { episode } = view;

  return (
    <>
      <TopBar>
        <span className="muted" style={{ fontSize: 14 }}>
          ／ {episode.project.name} · 第 {episode.episodeNumber} 集
        </span>
      </TopBar>

      <div className="topbar" style={{ top: 56 }}>
        <div className="container">
          <PipelineBar stages={view.stages} progress={progress} />
        </div>
      </div>

      <main className="container page-pad">
        <InputPanel view={view} progress={progress} refetch={refetch} />
        <AssetsPanel view={view} progress={progress} refetch={refetch} />
        <ScriptPanel view={view} progress={progress} refetch={refetch} />
        <StoryboardPanel view={view} progress={progress} refetch={refetch} />
        <ImagesPanel view={view} progress={progress} refetch={refetch} live={live} />
        <VideosPanel view={view} progress={progress} refetch={refetch} live={live} />
        <VoicePanel view={view} progress={progress} refetch={refetch} />
        <ExportPanel view={view} progress={progress} refetch={refetch} />
      </main>

      <NextActionCard nextAction={view.nextAction} refetch={refetch} />
      <FailureDrawer episodeId={episodeId} failedCount={view.failedTasks} onChange={refetch} />
    </>
  );
}
