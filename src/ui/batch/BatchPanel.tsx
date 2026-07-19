"use client";
// 批量出片（全季生成）面板：一鍵開批量 + 選項 modal + 停止掣 + 全季進度板。
// 後端見 POST/DELETE /api/projects/:id/batch（docs/plans/2026-07-19-batch-generation-design.md）。
// 進度板純由 episode.status + failedTasks 推導（輕量，跟住 project GET 輪詢刷新）。
import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/ui/api";
import { STATIONS } from "@/ui/episode/stations";
import type { EpisodeListItem } from "@/ui/types";

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

// Map an episode's coarse status to the "current" station index (1..8). Status
// has no distinct 配音(7) stage, so it jumps 視頻(6)→成片(8); 99 = fully done.
const STATUS_STATION: Record<string, number> = {
  draft: 1,
  assets: 2,
  script: 3,
  storyboard: 4,
  images: 5,
  videos: 6,
  export: 8,
  done: 99,
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

function StationStrip({ status, failed }: { status: string; failed: boolean }) {
  const cur = STATUS_STATION[status] ?? 1;
  return (
    <div className="batch-strip">
      {STATIONS.map((st) => {
        const state = st.index < cur ? "done" : st.index === cur ? "current" : "pending";
        const cls = state === "current" && failed ? "failed" : state;
        return <span key={st.key} className={`strip-seg ${cls}`} title={st.name} />;
      })}
    </div>
  );
}

export function BatchPanel({
  id,
  episodes,
  refetch,
}: {
  id: string;
  episodes: EpisodeListItem[];
  refetch: () => Promise<void>;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [opts, setOpts] = useState<BatchOptions>({ autoConfirmStoryboard: true, skipVideo: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const running = episodes.some((e) => e.autorun);

  // While a batch is running, keep the board fresh by re-polling the project.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void refetch(), 5000);
    return () => clearInterval(t);
  }, [running, refetch]);

  async function start() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await api.post<StartResult>(`/api/projects/${id}/batch`, opts);
      setModalOpen(false);
      const skipped = res.skippedDone > 0 ? `（跳過 ${res.skippedDone} 集已完成）` : "";
      setMsg(`已開始批量生成 ${res.started} 集${skipped}`);
      await refetch();
    } catch (e) {
      setErr((e as ApiClientError).message);
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await api.del<{ stopped: number }>(`/api/projects/${id}/batch`);
      setMsg(`已停止 ${res.stopped} 集的批量生成（進行中的任務會自然完成）`);
      await refetch();
    } catch (e) {
      setErr((e as ApiClientError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card section-gap">
      <div className="batch-head">
        <div>
          <h2 style={{ fontSize: 18 }}>批量生成全季</h2>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 14 }}>
            規劃好各集後一鍵全季自動出片，唔使逐集手動行八站。
          </p>
        </div>
        <div className="batch-actions">
          {running && (
            <button className="btn btn-danger" onClick={stop} disabled={busy}>
              {busy ? <span className="spinner" /> : "⏹ 停止批量"}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setModalOpen(true)} disabled={busy}>
            🚀 批量生成
          </button>
        </div>
      </div>

      {msg && <p className="batch-msg ok">{msg}</p>}
      {err && <p className="error-text" style={{ marginTop: 12 }}>{err}</p>}

      {episodes.length > 0 && (
        <div className="batch-board">
          {episodes.map((ep) => {
            const failed = (ep.failedTasks ?? 0) > 0;
            return (
              <div key={ep.id} className={`batch-row${failed ? " failed" : ""}`}>
                <span className="batch-ep-no">第 {ep.episodeNumber} 集</span>
                <span className="badge">{STATUS_LABEL[ep.status] ?? ep.status}</span>
                <StationStrip status={ep.status} failed={failed} />
                {ep.autorun && <span className="badge" title="批量生成中">自動</span>}
                {failed && (
                  <span className="fail-badge" title={`${ep.failedTasks} 個失敗任務`}>
                    {ep.failedTasks}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <div className="modal-backdrop" onClick={() => !busy && setModalOpen(false)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h2>批量生成選項</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
              資產（角色／場景）必須先鎖定先可以開始批量。未鎖會提示你返去揀圖。
            </p>

            <label className="batch-opt">
              <input
                type="checkbox"
                checked={opts.autoConfirmStoryboard}
                onChange={(e) => setOpts((o) => ({ ...o, autoConfirmStoryboard: e.target.checked }))}
              />
              <span>
                <strong>自動確認分鏡</strong>
                <span className="muted"> — 唔逐集停低等人手確認；關咗則每集停喺分鏡站亮燈等你。</span>
              </span>
            </label>

            <label className="batch-opt">
              <input
                type="checkbox"
                checked={opts.skipVideo}
                onChange={(e) => setOpts((o) => ({ ...o, skipVideo: e.target.checked }))}
              />
              <span>
                <strong>跳過視頻（省錢模式）</strong>
                <span className="muted"> — 圖像完成後直接配音→合成，用靜態圖出片，慳返視頻生成費。</span>
              </span>
            </label>

            <p className="plan-note">實際成本視乎你揀嘅模型而定；project 預算上限照樣把關。</p>

            {err && <p className="error-text" style={{ marginTop: 12 }}>{err}</p>}

            <div className="row-end">
              <button className="btn" onClick={() => setModalOpen(false)} disabled={busy}>
                取消
              </button>
              <button className="btn btn-primary" onClick={start} disabled={busy}>
                {busy ? <span className="spinner" /> : "開始批量"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
