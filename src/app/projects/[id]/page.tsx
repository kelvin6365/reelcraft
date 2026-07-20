"use client";
import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiClientError } from "@/ui/api";
import { TopBar } from "@/ui/TopBar";
import { PlanSetup } from "@/ui/planning/PlanSetup";
import { PlanReview } from "@/ui/planning/PlanReview";
import { ModelPicker } from "@/ui/planning/ModelPicker";
import { BatchPanel } from "@/ui/batch/BatchPanel";
import type { EpisodeListItem, ProjectPlanView } from "@/ui/types";

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

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [project, setProject] = useState<ProjectPlanView | null>(null);
  const [rawText, setRawText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      const p = await api.get<ProjectPlanView>(`/api/projects/${id}`);
      setProject(p);
      setErr(null);
    } catch (e) {
      const ce = e as ApiClientError;
      if (ce.code === "UNAUTHORIZED") router.replace("/signin");
      else setErr(ce.message);
    }
  }, [id, router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Poll while EPISODE_SPLIT is running; stop once planned (or on any other state).
  useEffect(() => {
    if (project?.planStatus !== "planning") return;
    const t = setInterval(() => void reload(), 1500);
    return () => clearInterval(t);
  }, [project?.planStatus, reload]);

  const isSrt = project?.inputType === "srt";
  const planned = project?.planStatus === "planned";
  const episodes = project?.episodes ?? [];
  const hasEpisodes = episodes.length > 0;

  async function createEpisode() {
    if (!rawText.trim()) {
      setErr(isSrt ? "請貼上 SRT 字幕。" : "請貼上小說原文。");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const ep = await api.post<{ id: string }>(`/api/projects/${id}/episodes`, { rawText: rawText.trim() });
      router.push(`/projects/${id}/episodes/${ep.id}`);
    } catch (e) {
      setErr((e as ApiClientError).message);
      setBusy(false);
    }
  }

  if (!project && !err) return <div className="center-screen">載入中…</div>;

  return (
    <>
      <TopBar>
        {project && <span className="muted" style={{ fontSize: 14 }}>／ {project.name}</span>}
      </TopBar>
      <main className="container page-pad">
        {err && <p className="error-text">{err}</p>}
        {project && (
          <>
            <div className="row" style={{ gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
              <h1 style={{ fontSize: 24 }}>{project.name}</h1>
              <span className="badge">{project.stylePackId}</span>
              <span className="badge">{project.videoRatio}</span>
            </div>

            <ModelPicker
              id={id}
              modelDefaults={project.modelDefaults}
              videoRatio={project.videoRatio}
              videoResolution={project.videoResolution ?? "720p"}
              refetch={reload}
            />

            {/* ---------- episode planning (novels only) ---------- */}
            {!isSrt && (
              <div className="section-gap">
                {!planned && (
                  <PlanSetup
                    id={id}
                    initialSourceText={project.sourceText}
                    initialTheme={(project as { theme?: string }).theme ?? ""}
                    initialConfig={project.planConfig}
                    planStatus={project.planStatus}
                    refetch={reload}
                  />
                )}

                {planned && project.planResult && (
                  hasEpisodes && !reviewOpen ? (
                    <div className="card plan-panel">
                      <div className="plan-review-head">
                        <div className="plan-tally">
                          <strong>已規劃 {project.planRisk?.total ?? project.planResult.episodes.length} 集</strong>
                          <span className="tally-dot">🔴 {project.planRisk?.problem ?? 0}</span>
                          <span className="tally-dot">🟡 {project.planRisk?.review ?? 0}</span>
                          <span className="tally-dot">🟢 {project.planRisk?.ok ?? 0}</span>
                        </div>
                        <button className="btn btn-sm" onClick={() => setReviewOpen(true)}>
                          展開規劃
                        </button>
                      </div>
                    </div>
                  ) : (
                    <PlanReview
                      id={id}
                      episodes={project.planResult.episodes}
                      risk={project.planRisk}
                      planConfig={project.planConfig}
                      hasEpisodes={hasEpisodes}
                      refetch={reload}
                    />
                  )
                )}
              </div>
            )}

            {/* ---------- manual single-episode create (legacy path kept) ---------- */}
            <div className="card section-gap">
              <h2 style={{ fontSize: 18, marginBottom: 4 }}>新增一集</h2>
              <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
                {isSrt
                  ? "貼上 SRT 字幕，系統會按字幕逐句建立分鏡與配音，然後帶你行流程。"
                  : "唔想規劃整部小說？貼上單集原文，系統會直接建立一集帶你行八站流程。"}
              </p>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                rows={8}
                placeholder={isSrt ? "喺呢度貼上 SRT 字幕內容…" : "喺呢度貼上小說章節原文…"}
              />
              <div className="row-end">
                <button className="btn btn-primary" onClick={createEpisode} disabled={busy}>
                  {busy ? <span className="spinner" /> : "建立這一集"}
                </button>
              </div>
            </div>

            {hasEpisodes && <BatchPanel id={id} episodes={episodes} refetch={reload} />}

            <div className="section-gap">
              <h2 style={{ fontSize: 18, marginBottom: 14 }}>劇集</h2>
              {episodes.length === 0 ? (
                <div className="empty">仲未有劇集。喺上面規劃分集或貼原文建立第一集。</div>
              ) : (
                <div className="grid">
                  {episodes.map((ep: EpisodeListItem) => (
                    <div
                      key={ep.id}
                      className="card project-card"
                      onClick={() => router.push(`/projects/${id}/episodes/${ep.id}`)}
                    >
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <h3 style={{ fontSize: 17 }}>第 {ep.episodeNumber} 集</h3>
                        <span className="badge">{STATUS_LABEL[ep.status] ?? ep.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </>
  );
}
