"use client";
import { Fragment, type ReactNode } from "react";
import { AlertTriangle, Check, Hand, Loader2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { StageKey, StageState } from "@/ui/types";
import { STATIONS } from "./stations";

type RailState = "done" | "active" | "failed" | "review" | "blocked" | "todo";

function railState(s: StageState | undefined, pct: number | undefined, failures: number): RailState {
  if (typeof pct === "number") return "active";
  if (failures > 0) return "failed";
  return s?.status ?? "todo";
}

const RING: Record<RailState, string> = {
  done: "bg-primary text-primary-foreground",
  active: "bg-primary/15 text-primary ring-2 ring-primary",
  failed: "bg-destructive/15 text-destructive ring-2 ring-destructive",
  review: "bg-amber-500/15 text-amber-600 ring-2 ring-amber-500 dark:text-amber-400",
  blocked: "bg-muted text-muted-foreground/50",
  todo: "bg-muted text-muted-foreground",
};

function StateIcon({ state, index }: { state: RailState; index: number }) {
  if (state === "done") return <Check className="size-4" />;
  if (state === "active") return <Loader2 className="size-4 animate-spin" />;
  if (state === "failed") return <AlertTriangle className="size-4" />;
  if (state === "review") return <Hand className="size-4" />;
  if (state === "blocked") return <Lock className="size-3.5" />;
  return <>{index}</>;
}

export function PipelineBar({
  stages,
  progress,
  failedByStage,
  current,
  onSelect,
  notice,
  autoAdvance,
  onToggleAutoAdvance,
  toggleBusy,
}: {
  stages: StageState[];
  progress: Partial<Record<StageKey, number>>;
  failedByStage: Partial<Record<StageKey, number>>;
  current: StageKey;
  onSelect: (key: StageKey) => void;
  notice?: ReactNode;
  autoAdvance?: { enabled: boolean; mode: string | null };
  onToggleAutoAdvance?: (on: boolean) => void;
  toggleBusy?: boolean;
}) {
  const byKey = Object.fromEntries(stages.map((s) => [s.key, s])) as Record<StageKey, StageState | undefined>;
  const doneCount = stages.filter((s) => s.done).length;
  const overallPct = Math.round((doneCount / STATIONS.length) * 100);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">八站流程進度</CardTitle>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            已完成 {doneCount} / {STATIONS.length} 站 · 整體進度 {overallPct}%
          </span>
          {autoAdvance?.mode === "batch" ? (
            <Badge variant="secondary">批量生成中</Badge>
          ) : (
            <label
              className="flex items-center gap-2 text-sm text-muted-foreground"
              title="開：免費步驟自動接力，使錢步驟先停低問你。閂：逐站手動。"
            >
              自動行進
              <Switch
                checked={!!autoAdvance?.enabled}
                disabled={toggleBusy}
                onCheckedChange={(v) => onToggleAutoAdvance?.(v)}
              />
            </label>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <nav aria-label="八站工作流">
          <ol className="flex items-start overflow-x-auto">
            {STATIONS.map((st, i) => {
              const s = byKey[st.key];
              const pct = progress[st.key];
              const failures = failedByStage[st.key] ?? 0;
              const state = railState(s, pct, failures);
              const isCurrent = st.key === current;
              const blockedBy = s?.blockedBy ?? [];

              const button = (
                <button
                  type="button"
                  onClick={() => onSelect(st.key)}
                  aria-current={isCurrent ? "step" : undefined}
                  aria-label={`第 ${st.index} 站 ${st.name}${failures > 0 ? `，${failures} 個失敗任務` : ""}${
                    state === "blocked" ? "，未解鎖" : ""
                  }`}
                  className={cn(
                    "flex w-18 shrink-0 cursor-pointer flex-col items-center gap-2 rounded-md px-1 py-1 text-center transition-colors hover:bg-accent/50",
                    isCurrent && "bg-accent",
                  )}
                >
                  <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-colors">
                    <span className={cn("flex size-9 items-center justify-center rounded-full", RING[state])}>
                      <StateIcon state={state} index={st.index} />
                    </span>
                    {failures > 0 && state !== "failed" && (
                      <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-white">
                        {failures}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "text-xs leading-tight font-medium",
                      isCurrent ? "text-foreground" : state === "blocked" ? "text-muted-foreground/60" : "text-muted-foreground",
                      (state === "done" || state === "active") && !isCurrent && "text-foreground",
                    )}
                  >
                    {st.name}
                  </span>
                  {state === "active" ? (
                    <span className="text-[11px] text-primary">生成中 {pct}%</span>
                  ) : state === "failed" ? (
                    <span className="text-[11px] text-destructive">{failures} 個失敗</span>
                  ) : state === "review" ? (
                    <span className="text-[11px] text-amber-600 dark:text-amber-400">待你確認</span>
                  ) : (
                    s?.count &&
                    s.count.total > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        {s.count.done}/{s.count.total}
                      </span>
                    )
                  )}
                </button>
              );

              return (
                <Fragment key={st.key}>
                  <li className="contents">
                    {blockedBy.length > 0 ? (
                      <Tooltip>
                        <TooltipTrigger asChild>{button}</TooltipTrigger>
                        <TooltipContent>
                          <p className="font-medium">仲差：</p>
                          <ul className="mt-0.5 list-disc pl-4">
                            {blockedBy.map((b) => (
                              <li key={b}>{b}</li>
                            ))}
                          </ul>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      button
                    )}
                  </li>
                  {i < STATIONS.length - 1 && (
                    <div className={cn("mt-4.5 h-px flex-1", s?.done ? "bg-primary" : "bg-border")} />
                  )}
                </Fragment>
              );
            })}
          </ol>
        </nav>
        <Progress
          value={overallPct}
          className="h-2"
          aria-label="整體進度"
          aria-valuetext={`已完成 ${doneCount} 站，共 ${STATIONS.length} 站`}
        />
        {notice}
      </CardContent>
    </Card>
  );
}
