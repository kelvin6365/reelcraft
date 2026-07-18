"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiClientError } from "@/ui/api";
import { TopBar } from "@/ui/TopBar";
import { useSession } from "@/ui/auth-client";
import type { ProjectSummary } from "@/ui/types";

const STYLE_PACKS = [
  { id: "cinematic-01", label: "電影感 cinematic-01" },
  { id: "anime-01", label: "動漫 anime-01" },
];
const RATIOS = ["9:16", "16:9"];

export default function ProjectsPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.replace("/signin");
      return;
    }
    api
      .get<ProjectSummary[]>("/api/projects")
      .then(setProjects)
      .catch((e: ApiClientError) => setLoadErr(e.message));
  }, [isPending, session, router]);

  if (isPending || (!projects && !loadErr)) return <div className="center-screen">載入中…</div>;

  return (
    <>
      <TopBar />
      <main className="container page-pad">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 20 }}>
          <h1 style={{ fontSize: 24 }}>我的專案</h1>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            + 新專案
          </button>
        </div>

        {loadErr && <p className="error-text">{loadErr}</p>}

        {projects && projects.length === 0 && (
          <div className="empty">
            <p style={{ fontSize: 16, marginTop: 0 }}>仲未有專案。</p>
            <p>建立第一個專案，貼一段小說，行八站流程出一集短劇。</p>
            <button className="btn btn-primary" onClick={() => setShowModal(true)} style={{ marginTop: 8 }}>
              + 建立專案
            </button>
          </div>
        )}

        {projects && projects.length > 0 && (
          <div className="grid">
            {projects.map((p) => (
              <div key={p.id} className="card project-card" onClick={() => router.push(`/projects/${p.id}`)}>
                <h3 style={{ fontSize: 17 }}>{p.name}</h3>
                <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <span className="badge">{p.stylePackId}</span>
                  <span className="badge">{p.videoRatio}</span>
                  <span className="badge">{p.episodes.length} 集</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {showModal && (
        <CreateProjectModal
          onClose={() => setShowModal(false)}
          onCreated={(p) => {
            setShowModal(false);
            router.push(`/projects/${p.id}`);
          }}
        />
      )}
    </>
  );
}

function CreateProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: ProjectSummary) => void;
}) {
  const [name, setName] = useState("");
  const [stylePackId, setStylePackId] = useState(STYLE_PACKS[0].id);
  const [videoRatio, setVideoRatio] = useState(RATIOS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) {
      setErr("請輸入專案名稱。");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const p = await api.post<ProjectSummary>("/api/projects", { name: name.trim(), stylePackId, videoRatio });
      onCreated({ ...p, episodes: p.episodes ?? [] });
    } catch (e) {
      setErr((e as ApiClientError).message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <h2>新專案</h2>
        <div className="field">
          <label>專案名稱</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="例：宮鬥短劇 第一部" />
        </div>
        <div className="field">
          <label>畫風包</label>
          <select value={stylePackId} onChange={(e) => setStylePackId(e.target.value)}>
            {STYLE_PACKS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>比例</label>
          <select value={videoRatio} onChange={(e) => setVideoRatio(e.target.value)}>
            {RATIOS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        {err && (
          <p className="error-text" style={{ marginTop: 12 }}>
            {err}
          </p>
        )}
        <div className="row-end">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="btn btn-primary" onClick={create} disabled={busy}>
            {busy ? <span className="spinner" /> : "建立"}
          </button>
        </div>
      </div>
    </div>
  );
}
