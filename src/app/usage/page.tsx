"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { type UsageDays, USAGE_DAYS_OPTIONS, usageQuery } from "@/ui/query-keys";
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
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// 每個 section 獨立嘅錯誤狀態：顯示錯誤訊息 + 「重試」按鈕（TanStack Query refetch）。
function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 p-6">
        <p className="text-sm text-destructive">{message}</p>
        <Button size="sm" variant="outline" onClick={onRetry}>
          重試
        </Button>
      </CardContent>
    </Card>
  );
}

// 用量儀表板（M2-T2）：全部由 ai_call_logs 出。三次 fetch（按日/按模型/按集），
// totals 與 errorTop 由「按日」那次取得（與 groupBy 無關）。
export default function UsagePage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const enabled = !isPending && !!session;
  const [days, setDays] = useState<UsageDays>(30);
  const dayQuery = useQuery({ ...usageQuery("day", days), enabled });
  const modelQuery = useQuery({ ...usageQuery("model", days), enabled });
  const episodeQuery = useQuery({ ...usageQuery("episode", days), enabled });
  const promptQuery = useQuery({ ...usageQuery("prompt", days), enabled });

  useEffect(() => {
    if (isPending) return;
    if (!session) router.replace("/signin");
  }, [isPending, session, router]);

  const byDay = dayQuery.data ?? null;
  const byModel = modelQuery.data ?? null;
  const byEpisode = episodeQuery.data ?? null;
  const byPrompt = promptQuery.data ?? null;

  if (isPending || !session) {
    return (
      <AppShell active="usage" title="用量">
        <div className="space-y-6 p-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">用量</h1>
            <p className="mt-1 text-sm text-muted-foreground">最近 30 日 · 資料來自 AI 呼叫日誌</p>
          </div>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
          <Skeleton className="h-48 w-full" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="usage" title="用量">
      <div className="space-y-6 p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">用量</h1>
            <p className="mt-1 text-sm text-muted-foreground">最近 {days} 日 · 資料來自 AI 呼叫日誌</p>
          </div>
          <Tabs value={String(days)} onValueChange={(v) => setDays(Number(v) as UsageDays)}>
            <TabsList>
              {USAGE_DAYS_OPTIONS.map((d) => (
                <TabsTrigger key={d} value={String(d)}>
                  {d} 日
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {dayQuery.error ? (
          <SectionError message={dayQuery.error.message} onRetry={() => dayQuery.refetch()} />
        ) : byDay ? (
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
              {modelQuery.error ? (
                <SectionError message={modelQuery.error.message} onRetry={() => modelQuery.refetch()} />
              ) : byModel ? (
                <ModelTable rows={byModel.rows} days={days} />
              ) : (
                <Skeleton className="h-48 w-full" />
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-medium">按集成本</h2>
              {episodeQuery.error ? (
                <SectionError message={episodeQuery.error.message} onRetry={() => episodeQuery.refetch()} />
              ) : byEpisode ? (
                <EpisodeTable rows={byEpisode.rows} days={days} />
              ) : (
                <Skeleton className="h-48 w-full" />
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-medium">Prompt Token 排行</h2>
              {promptQuery.error ? (
                <SectionError message={promptQuery.error.message} onRetry={() => promptQuery.refetch()} />
              ) : byPrompt ? (
                <PromptTable rows={byPrompt.rows} />
              ) : (
                <Skeleton className="h-48 w-full" />
              )}
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
