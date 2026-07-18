"use client";
// One planned-episode card in the review-by-exception UI. Inline title edit
// (PATCH rename on blur), risk badge + flag chips, and per-flag one-click fixes
// (merge/split/move — all pure planResult ops server-side, no AI) plus delete
// and re-plan. Split/move need a boundary the client can't compute, so we ask
// for a short anchor substring via prompt() (kept simple for v1).
import { useState } from "react";
import { api } from "@/ui/api";
import { useAction } from "./useAction";
import type { PlanConfigView, PlannedEpisode, RiskFlag, RiskLevel } from "@/ui/types";

const LEVEL_EMOJI: Record<RiskLevel, string> = { ok: "🟢", review: "🟡", problem: "🔴" };

const FLAG_LABEL: Record<RiskFlag, string> = {
  weak_hook: "結尾鉤子弱",
  too_long: "偏長",
  too_short: "偏短",
  low_density: "劇情密度低",
  mid_scene_cut: "場景中間切斷",
  dialogue_overflow: "對白過多",
};

// Which one-click fix each flag suggests.
type FixKind = "merge" | "split" | "move";
const FLAG_FIX: Record<RiskFlag, FixKind> = {
  weak_hook: "merge",
  too_short: "merge",
  low_density: "merge",
  too_long: "split",
  dialogue_overflow: "split",
  mid_scene_cut: "move",
};
const FIX_LABEL: Record<FixKind, string> = {
  merge: "併入上一集",
  split: "拆分",
  move: "移動邊界",
};

export function EpisodeCard({
  id,
  ep,
  isFirst,
  planConfig,
  refetch,
}: {
  id: string;
  ep: PlannedEpisode;
  isFirst: boolean;
  planConfig: PlanConfigView | null;
  refetch: () => Promise<void>;
}) {
  const [title, setTitle] = useState(ep.title);
  const { busy, err, run } = useAction(refetch);

  const level = ep.risk?.level ?? "ok";
  const flags = ep.risk?.flags ?? [];

  function saveTitle() {
    const t = title.trim();
    if (!t || t === ep.title) return;
    void run(() => api.patch(`/api/projects/${id}/plan`, { op: "rename", index: ep.index, title: t }));
  }

  function doFix(kind: FixKind) {
    if (kind === "merge") {
      void run(() => api.patch(`/api/projects/${id}/plan`, { op: "merge", index: ep.index }));
      return;
    }
    if (kind === "split") {
      const at = window.prompt("請輸入分段點的原文片段（下一集由此句開始）：");
      if (!at?.trim()) return;
      void run(() =>
        api.patch(`/api/projects/${id}/plan`, {
          op: "split",
          index: ep.index,
          atEndAnchor: at.trim(),
          nextStartAnchor: at.trim(),
        }),
      );
      return;
    }
    // move boundary between this episode and the next
    const at = window.prompt("請輸入新邊界的原文片段（下一集由此句開始）：");
    if (!at?.trim()) return;
    void run(() =>
      api.patch(`/api/projects/${id}/plan`, {
        op: "move",
        index: ep.index,
        newEndAnchor: at.trim(),
        newNextStartAnchor: at.trim(),
      }),
    );
  }

  function replan() {
    if (!planConfig) return;
    const body =
      planConfig.anchor === "length"
        ? { anchor: "length", seconds: planConfig.seconds ?? 90, hookStrength: planConfig.hookStrength }
        : { anchor: "count", count: planConfig.count ?? 12, hookStrength: planConfig.hookStrength };
    void run(() => api.post(`/api/projects/${id}/plan`, body));
  }

  // De-dupe fix buttons: many flags can map to the same action. A merge is only
  // possible when there is a previous episode.
  const fixes = Array.from(new Set(flags.map((f) => FLAG_FIX[f]))).filter(
    (k) => !(k === "merge" && isFirst),
  );

  return (
    <div className={`plan-ep-card lv-${level}`}>
      <div className="plan-ep-head">
        <span className="plan-ep-idx">第 {ep.index} 集</span>
        <input
          className="plan-ep-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          disabled={busy}
        />
        <span className="plan-ep-badge" title={level}>{LEVEL_EMOJI[level]}</span>
      </div>

      {ep.summary && <p className="plan-ep-summary">{ep.summary}</p>}
      {ep.hook && (
        <p className="plan-ep-hook">
          <span className="faint">鉤子</span> {ep.hook}
        </p>
      )}
      <p className="plan-ep-anchors">
        <span className="faint">原文預覽</span> {ep.startAnchor} … {ep.endAnchor}
      </p>

      {level !== "ok" && (
        <div className="plan-ep-risk">
          {flags.length > 0 && (
            <div className="plan-flags">
              {flags.map((f) => (
                <span key={f} className={`risk-chip lv-${level}`}>{FLAG_LABEL[f]}</span>
              ))}
            </div>
          )}
          {ep.risk?.note && <p className="plan-ep-note">{ep.risk.note}</p>}
        </div>
      )}

      <div className="plan-ep-actions">
        {fixes.map((k) => (
          <button key={k} className="btn btn-sm" onClick={() => doFix(k)} disabled={busy}>
            {FIX_LABEL[k]}
          </button>
        ))}
        <button className="btn btn-sm" onClick={replan} disabled={busy || !planConfig}>
          重新規劃
        </button>
        <button
          className="btn btn-sm btn-danger"
          onClick={() => run(() => api.patch(`/api/projects/${id}/plan`, { op: "delete", index: ep.index }))}
          disabled={busy}
        >
          刪除
        </button>
        {busy && <span className="spinner" />}
      </div>
      {err && <p className="error-text" style={{ marginTop: 8 }}>{err}</p>}
    </div>
  );
}
