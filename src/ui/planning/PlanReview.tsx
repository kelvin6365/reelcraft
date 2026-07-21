"use client";
// Review-by-exception UI once planStatus==='planned'. Header shows the
// traffic-light tally + a 「只顯示要處理」toggle (default ON). 🔴/🟡 cards are
// listed; 🟢 cards collapse into one row. Footer confirms → creates N episodes
// (409 EPISODES_EXIST → confirm() dialog → retry force:true).
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api, ApiClientError } from "@/ui/api";
import { qk } from "@/ui/query-keys";
import { EpisodeCard } from "./EpisodeCard";
import type { PlanConfigView, PlanRisk, PlannedEpisode } from "@/ui/types";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export function PlanReview({
  id,
  episodes,
  risk,
  planConfig,
  hasEpisodes,
}: {
  id: string;
  episodes: PlannedEpisode[];
  risk: PlanRisk | null;
  planConfig: PlanConfigView | null;
  hasEpisodes: boolean;
}) {
  const [onlyProblems, setOnlyProblems] = useState(true);
  const [greenOpen, setGreenOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const queryClient = useQueryClient();

  const confirmMutation = useMutation({
    mutationFn: (force: boolean) => api.post<{ created: number }>(`/api/projects/${id}/plan/confirm`, { force }),
    onSuccess: async () => {
      setErr(null);
      await queryClient.invalidateQueries({ queryKey: qk.project(id) });
    },
  });
  const confirming = confirmMutation.isPending;

  const problemEps = episodes.filter((e) => (e.risk?.level ?? "ok") !== "ok");
  const okEps = episodes.filter((e) => (e.risk?.level ?? "ok") === "ok");
  const tally = risk ?? { total: episodes.length, problem: 0, review: 0, ok: episodes.length };

  async function confirm(force = false) {
    setErr(null);
    try {
      await confirmMutation.mutateAsync(force);
    } catch (e) {
      const ce = e as ApiClientError;
      if (ce.code === "EPISODES_EXIST" && !force) {
        setConflictOpen(true);
      } else {
        setErr(ce.message);
      }
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="text-base">已規劃 {tally.total} 集</CardTitle>
          <span className="text-sm text-muted-foreground">🔴 {tally.problem}</span>
          <span className="text-sm text-muted-foreground">🟡 {tally.review}</span>
          <span className="text-sm text-muted-foreground">🟢 {tally.ok}</span>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="only-problems"
            checked={onlyProblems}
            onCheckedChange={(v) => setOnlyProblems(v === true)}
          />
          <Label htmlFor="only-problems" className="text-sm font-normal">只顯示要處理</Label>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {onlyProblems && problemEps.length === 0 && (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            全部集穩妥，冇需要處理嘅項目 ✓
          </div>
        )}
        {(onlyProblems ? problemEps : episodes).map((ep) => (
          <EpisodeCard
            key={ep.index}
            id={id}
            ep={ep}
            isFirst={ep.index === 1}
            planConfig={planConfig}
          />
        ))}

        {onlyProblems && okEps.length > 0 && (
          greenOpen ? (
            okEps.map((ep) => (
              <EpisodeCard
                key={ep.index}
                id={id}
                ep={ep}
                isFirst={ep.index === 1}
                planConfig={planConfig}
              />
            ))
          ) : (
            <Button variant="ghost" className="w-full" onClick={() => setGreenOpen(true)}>
              {okEps.length} 集穩妥 ✓（點擊展開）
            </Button>
          )
        )}
        {onlyProblems && greenOpen && okEps.length > 0 && (
          <Button variant="ghost" className="w-full" onClick={() => setGreenOpen(false)}>
            收起穩妥嘅 {okEps.length} 集
          </Button>
        )}

        {err && <p className="text-sm text-destructive">{err}</p>}
      </CardContent>

      <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t">
        <span className="text-sm text-muted-foreground">
          {hasEpisodes
            ? "已生成劇集。重新確認會依照上面嘅規劃重建未開工嘅集。"
            : `確認後會依錨點切分，建立 ${tally.total} 集草稿。`}
        </span>
        <Button onClick={() => confirm(false)} disabled={confirming}>
          {confirming && <Loader2 className="animate-spin" />}
          {confirming ? "生成中…" : `確認生成 ${tally.total} 集`}
        </Button>
      </CardFooter>

      <ConfirmDialog
        open={conflictOpen}
        onOpenChange={setConflictOpen}
        title="呢個項目已經有劇集"
        description="重新確認會清走未開工嘅集並重建。繼續？"
        destructive
        confirmLabel="重新確認"
        onConfirm={() => confirm(true)}
      />
    </Card>
  );
}
