"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiClientError } from "@/ui/api";
import { TopBar } from "@/ui/TopBar";
import { useSession } from "@/ui/auth-client";
import type { UsageResponse } from "@/ui/types";
import { OverviewCards } from "@/ui/usage/OverviewCards";
import { DailyCostChart } from "@/ui/usage/DailyCostChart";
import { ModelTable } from "@/ui/usage/ModelTable";
import { EpisodeTable } from "@/ui/usage/EpisodeTable";
import { PromptTable } from "@/ui/usage/PromptTable";
import { ErrorTop } from "@/ui/usage/ErrorTop";

// 用量儀表板（M2-T2）：全部由 ai_call_logs 出。三次 fetch（按日/按模型/按集），
// totals 與 errorTop 由「按日」那次取得（與 groupBy 無關）。
export default function UsagePage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [byDay, setByDay] = useState<UsageResponse | null>(null);
  const [byModel, setByModel] = useState<UsageResponse | null>(null);
  const [byEpisode, setByEpisode] = useState<UsageResponse | null>(null);
  const [byPrompt, setByPrompt] = useState<UsageResponse | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.replace("/signin");
      return;
    }
    Promise.all([
      api.get<UsageResponse>("/api/usage?groupBy=day"),
      api.get<UsageResponse>("/api/usage?groupBy=model"),
      api.get<UsageResponse>("/api/usage?groupBy=episode"),
      api.get<UsageResponse>("/api/usage?groupBy=prompt"),
    ])
      .then(([d, m, e, p]) => {
        setByDay(d);
        setByModel(m);
        setByEpisode(e);
        setByPrompt(p);
      })
      .catch((e: ApiClientError) => setLoadErr(e.message));
  }, [isPending, session, router]);

  if (isPending || (!byDay && !loadErr)) return <div className="center-screen">載入中…</div>;

  return (
    <>
      <TopBar />
      <main className="container page-pad">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
          <h1 style={{ fontSize: 24 }}>用量</h1>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          最近 30 日 · 資料來自 AI 呼叫日誌
        </p>

        {loadErr && <p className="error-text">{loadErr}</p>}

        {byDay && (
          <>
            <OverviewCards totals={byDay.totals} />

            <section className="usage-section">
              <h2>按日成本</h2>
              <DailyCostChart rows={byDay.rows} />
              {byDay.totals.uncostedCalls > 0 && (
                <p className="uncosted-note">
                  有 {byDay.totals.uncostedCalls} 次呼叫未計價（定價目錄建立前的舊紀錄），未計入上方成本。
                </p>
              )}
            </section>

            <section className="usage-section">
              <h2>按模型</h2>
              {byModel && <ModelTable rows={byModel.rows} />}
            </section>

            <section className="usage-section">
              <h2>按集成本</h2>
              {byEpisode && <EpisodeTable rows={byEpisode.rows} />}
            </section>

            <section className="usage-section">
              <h2>Prompt Token 排行</h2>
              {byPrompt && <PromptTable rows={byPrompt.rows} />}
            </section>

            <section className="usage-section">
              <h2>錯誤排行</h2>
              <ErrorTop errors={byDay.errorTop} />
            </section>
          </>
        )}
      </main>
    </>
  );
}
