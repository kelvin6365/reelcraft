"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { usageQuery } from "@/ui/query-keys";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/ui/auth-client";
import { OverviewCards } from "@/ui/usage/OverviewCards";
import { DailyCostChart } from "@/ui/usage/DailyCostChart";
import { ModelTable } from "@/ui/usage/ModelTable";
import { EpisodeTable } from "@/ui/usage/EpisodeTable";
import { PromptTable } from "@/ui/usage/PromptTable";
import { ErrorTop } from "@/ui/usage/ErrorTop";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// 用量儀表板（M2-T2）：全部由 ai_call_logs 出。三次 fetch（按日/按模型/按集），
// totals 與 errorTop 由「按日」那次取得（與 groupBy 無關）。
export default function UsagePage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const enabled = !isPending && !!session;
  const dayQuery = useQuery({ ...usageQuery("day"), enabled });
  const modelQuery = useQuery({ ...usageQuery("model"), enabled });
  const episodeQuery = useQuery({ ...usageQuery("episode"), enabled });
  const promptQuery = useQuery({ ...usageQuery("prompt"), enabled });

  useEffect(() => {
    if (isPending) return;
    if (!session) router.replace("/signin");
  }, [isPending, session, router]);

  const byDay = dayQuery.data ?? null;
  const byModel = modelQuery.data ?? null;
  const byEpisode = episodeQuery.data ?? null;
  const byPrompt = promptQuery.data ?? null;
  const loadErr =
    dayQuery.error?.message ?? modelQuery.error?.message ?? episodeQuery.error?.message ?? promptQuery.error?.message ?? null;

  if (isPending || !session) {
    return <div className="flex min-h-svh items-center justify-center text-muted-foreground">載入中…</div>;
  }

  return (
    <AppShell active="usage" title="用量">
      <div className="space-y-6 p-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">用量</h1>
          <p className="mt-1 text-sm text-muted-foreground">最近 30 日 · 資料來自 AI 呼叫日誌</p>
        </div>

        {loadErr && <p className="text-sm text-destructive">{loadErr}</p>}

        {byDay ? (
          <>
            <OverviewCards totals={byDay.totals} />

            <section className="space-y-3">
              <h2 className="text-lg font-medium">按日成本</h2>
              <Card>
                <CardContent className="p-6">
                  <DailyCostChart rows={byDay.rows} />
                  {byDay.totals.uncostedCalls > 0 && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      有 {byDay.totals.uncostedCalls} 次呼叫未計價（定價目錄建立前的舊紀錄），未計入上方成本。
                    </p>
                  )}
                </CardContent>
              </Card>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-medium">按模型</h2>
              {byModel ? <ModelTable rows={byModel.rows} /> : <Skeleton className="h-48 w-full" />}
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-medium">按集成本</h2>
              {byEpisode ? <EpisodeTable rows={byEpisode.rows} /> : <Skeleton className="h-48 w-full" />}
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-medium">Prompt Token 排行</h2>
              {byPrompt ? <PromptTable rows={byPrompt.rows} /> : <Skeleton className="h-48 w-full" />}
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-medium">錯誤排行</h2>
              <ErrorTop errors={byDay.errorTop} />
            </section>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
