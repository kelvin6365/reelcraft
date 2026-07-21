"use client";
// One planned-episode card in the review-by-exception UI. Inline title edit
// (PATCH rename on blur), risk badge + flag chips, and per-flag one-click fixes
// (merge/split/move — all pure planResult ops server-side, no AI) plus delete
// and re-plan. Split/move need a boundary the client can't compute, so we ask
// for a short anchor substring via prompt() (kept simple for v1).
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/ui/api";
import { qk } from "@/ui/query-keys";
import { useAction } from "./useAction";
import type { PlanConfigView, PlannedEpisode, RiskFlag, RiskLevel } from "@/ui/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const LEVEL_LABEL: Record<RiskLevel, string> = { ok: "自動通過", review: "建議覆核", problem: "需人工覆核" };
const LEVEL_DOT: Record<RiskLevel, string> = {
  ok: "bg-green-500",
  review: "bg-yellow-400",
  problem: "bg-destructive",
};

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
}: {
  id: string;
  ep: PlannedEpisode;
  isFirst: boolean;
  planConfig: PlanConfigView | null;
}) {
  const [title, setTitle] = useState(ep.title);
  const { busy, err, run } = useAction(qk.project(id));

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
    <Card
      className={cn(
        "gap-3 py-4",
        level === "problem" && "border-destructive/40",
        level === "review" && "border-yellow-500/40",
      )}
    >
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="font-mono">第 {ep.index} 集</Badge>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            disabled={busy}
            className="h-8 flex-1 border-transparent bg-transparent px-2 font-medium shadow-none focus-visible:border-input"
          />
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("size-2 rounded-full", LEVEL_DOT[level])} />
            {LEVEL_LABEL[level]}
          </span>
        </div>

        {ep.summary && <p className="text-sm text-muted-foreground">{ep.summary}</p>}
        {ep.hook && (
          <p className="text-sm">
            <span className="text-muted-foreground">鉤子</span> {ep.hook}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          原文預覽 {ep.startAnchor} … {ep.endAnchor}
        </p>

        {level !== "ok" && (
          <div className="space-y-1.5">
            {flags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {flags.map((f) => (
                  <Badge
                    key={f}
                    variant="outline"
                    className={cn(
                      level === "problem" && "border-destructive/40 text-destructive",
                      level === "review" && "border-yellow-500/40 text-yellow-600 dark:text-yellow-400",
                    )}
                  >
                    {FLAG_LABEL[f]}
                  </Badge>
                ))}
              </div>
            )}
            {ep.risk?.note && <p className="text-xs text-muted-foreground">{ep.risk.note}</p>}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {fixes.map((k) => (
            <Button key={k} size="sm" variant="outline" onClick={() => doFix(k)} disabled={busy}>
              {FIX_LABEL[k]}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={replan} disabled={busy || !planConfig}>
            重新規劃
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => run(() => api.patch(`/api/projects/${id}/plan`, { op: "delete", index: ep.index }))}
            disabled={busy}
          >
            刪除
          </Button>
          {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
