"use client";
import { Fragment } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { StageKey, StageState } from "@/ui/types";
import { STATIONS, scrollToStation } from "./stations";

export function PipelineBar({
  stages,
  progress,
}: {
  stages: StageState[];
  progress: Partial<Record<StageKey, number>>;
}) {
  const byKey = Object.fromEntries(stages.map((s) => [s.key, s])) as Record<StageKey, StageState | undefined>;
  const doneCount = stages.filter((s) => s.done).length;
  const overallPct = Math.round((doneCount / STATIONS.length) * 100);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">八站流程進度</CardTitle>
        <span className="text-sm text-muted-foreground">
          已完成 {doneCount} / {STATIONS.length} 站 · 整體進度 {overallPct}%
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start overflow-x-auto">
          {STATIONS.map((st, i) => {
            const s = byKey[st.key];
            const pct = progress[st.key];
            const active = typeof pct === "number";
            const done = !!s?.done;
            return (
              <Fragment key={st.key}>
                <button
                  type="button"
                  onClick={() => scrollToStation(st.key)}
                  title={st.name}
                  className="flex w-18 shrink-0 flex-col items-center gap-2 text-center"
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-colors",
                      done
                        ? "bg-primary text-primary-foreground"
                        : active
                          ? "bg-primary/15 text-primary ring-2 ring-primary"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {done ? <Check className="size-4" /> : st.index}
                  </span>
                  <span
                    className={cn(
                      "text-xs leading-tight font-medium",
                      done || active ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {st.name}
                  </span>
                  {active ? (
                    <span className="text-[11px] text-primary">生成中 {pct}%</span>
                  ) : (
                    // hide "0/0" noise on stations whose work hasn't been created yet
                    s?.count &&
                    s.count.total > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        {s.count.done}/{s.count.total}
                      </span>
                    )
                  )}
                </button>
                {i < STATIONS.length - 1 && (
                  <div className={cn("mt-4.5 h-px flex-1", done ? "bg-primary" : "bg-border")} />
                )}
              </Fragment>
            );
          })}
        </div>
        <Progress value={overallPct} className="h-2" />
      </CardContent>
    </Card>
  );
}
