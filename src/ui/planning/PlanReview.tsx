"use client";
// Review-by-exception UI once planStatus==='planned'. Header shows the
// traffic-light tally + a 「只顯示要處理」toggle (default ON). 🔴/🟡 cards are
// listed; 🟢 cards collapse into one row. Footer confirms → creates N episodes
// (409 EPISODES_EXIST → confirm() dialog → retry force:true).
import { useState } from "react";
import { api, ApiClientError } from "@/ui/api";
import { EpisodeCard } from "./EpisodeCard";
import type { PlanConfigView, PlanRisk, PlannedEpisode } from "@/ui/types";

export function PlanReview({
  id,
  episodes,
  risk,
  planConfig,
  hasEpisodes,
  refetch,
}: {
  id: string;
  episodes: PlannedEpisode[];
  risk: PlanRisk | null;
  planConfig: PlanConfigView | null;
  hasEpisodes: boolean;
  refetch: () => Promise<void>;
}) {
  const [onlyProblems, setOnlyProblems] = useState(true);
  const [greenOpen, setGreenOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const problemEps = episodes.filter((e) => (e.risk?.level ?? "ok") !== "ok");
  const okEps = episodes.filter((e) => (e.risk?.level ?? "ok") === "ok");
  const tally = risk ?? { total: episodes.length, problem: 0, review: 0, ok: episodes.length };
  const showGreen = !onlyProblems || greenOpen;

  async function confirm(force = false) {
    setConfirming(true);
    setErr(null);
    try {
      await api.post<{ created: number }>(`/api/projects/${id}/plan/confirm`, { force });
      await refetch();
    } catch (e) {
      const ce = e as ApiClientError;
      if (ce.code === "EPISODES_EXIST" && !force) {
        if (window.confirm("呢個項目已經有劇集。重新確認會清走未開工嘅集並重建。繼續？")) {
          setConfirming(false);
          await confirm(true);
          return;
        }
      } else {
        setErr(ce.message);
      }
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="card plan-panel">
      <div className="plan-review-head">
        <div className="plan-tally">
          <strong>{tally.total} 集</strong>
          <span className="tally-dot">🔴 {tally.problem}</span>
          <span className="tally-dot">🟡 {tally.review}</span>
          <span className="tally-dot">🟢 {tally.ok}</span>
        </div>
        <label className="plan-filter">
          <input
            type="checkbox"
            checked={onlyProblems}
            onChange={(e) => setOnlyProblems(e.target.checked)}
          />
          只顯示要處理
        </label>
      </div>

      <div className="plan-ep-list">
        {onlyProblems && problemEps.length === 0 && (
          <div className="plan-all-clear">全部集穩妥，冇需要處理嘅項目 ✓</div>
        )}
        {(onlyProblems ? problemEps : episodes).map((ep) => (
          <EpisodeCard
            key={ep.index}
            id={id}
            ep={ep}
            isFirst={ep.index === 1}
            planConfig={planConfig}
            refetch={refetch}
          />
        ))}

        {onlyProblems && okEps.length > 0 && (
          showGreen ? (
            okEps.map((ep) => (
              <EpisodeCard
                key={ep.index}
                id={id}
                ep={ep}
                isFirst={ep.index === 1}
                planConfig={planConfig}
                refetch={refetch}
              />
            ))
          ) : (
            <button className="plan-green-row" onClick={() => setGreenOpen(true)}>
              {okEps.length} 集穩妥 ✓（點擊展開）
            </button>
          )
        )}
        {onlyProblems && greenOpen && okEps.length > 0 && (
          <button className="plan-green-row" onClick={() => setGreenOpen(false)}>
            收起穩妥嘅 {okEps.length} 集
          </button>
        )}
      </div>

      {err && <p className="error-text" style={{ marginTop: 10 }}>{err}</p>}

      <div className="plan-confirm-bar">
        <span className="muted" style={{ fontSize: 13 }}>
          {hasEpisodes
            ? "已生成劇集。重新確認會依照上面嘅規劃重建未開工嘅集。"
            : `確認後會依錨點切分，建立 ${tally.total} 集草稿。`}
        </span>
        <button className="btn btn-primary" onClick={() => confirm(false)} disabled={confirming}>
          {confirming ? <><span className="spinner" /> 生成中…</> : `確認生成 ${tally.total} 集`}
        </button>
      </div>
    </div>
  );
}
