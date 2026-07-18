"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiClientError } from "@/ui/api";
import { TopBar } from "@/ui/TopBar";
import type { EpisodeListItem, ProjectSummary } from "@/ui/types";

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
  const [project, setProject] = useState<(ProjectSummary & { episodes: EpisodeListItem[] }) | null>(null);
  const [rawText, setRawText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reload() {
    api
      .get<ProjectSummary & { episodes: EpisodeListItem[] }>(`/api/projects/${id}`)
      .then(setProject)
      .catch((e: ApiClientError) => {
        if (e.code === "UNAUTHORIZED") router.replace("/signin");
        else setErr(e.message);
      });
  }

  useEffect(reload, [id]);

  async function createEpisode() {
    if (!rawText.trim()) {
      setErr("請貼上小說原文。");
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

            <div className="card">
              <h2 style={{ fontSize: 18, marginBottom: 4 }}>新增一集</h2>
              <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
                貼上小說原文，系統會建立新一集，然後帶你行八站流程。
              </p>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                rows={8}
                placeholder="喺呢度貼上小說章節原文…"
              />
              <div className="row-end">
                <button className="btn btn-primary" onClick={createEpisode} disabled={busy}>
                  {busy ? <span className="spinner" /> : "建立這一集"}
                </button>
              </div>
            </div>

            <div className="section-gap">
              <h2 style={{ fontSize: 18, marginBottom: 14 }}>劇集</h2>
              {project.episodes.length === 0 ? (
                <div className="empty">仲未有劇集。喺上面貼原文建立第一集。</div>
              ) : (
                <div className="grid">
                  {project.episodes.map((ep) => (
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
