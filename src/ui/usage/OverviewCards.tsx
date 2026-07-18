"use client";
import type { UsageTotalsView } from "@/ui/types";
import { usd, int, pct } from "./format";

// ① 總覽卡：30 日總成本、總 calls、錯誤率。
export function OverviewCards({ totals }: { totals: UsageTotalsView }) {
  const errClass = totals.errorRate > 0.1 ? "danger" : totals.errorRate === 0 ? "good" : "";
  return (
    <div className="stat-row">
      <div className="stat-card">
        <div className="stat-label">總成本（USD）</div>
        <div className="stat-value">{usd(totals.estCostUsd)}</div>
        {totals.uncostedCalls > 0 && <div className="stat-sub">另有 {int(totals.uncostedCalls)} 次未計價</div>}
      </div>
      <div className="stat-card">
        <div className="stat-label">總呼叫次數</div>
        <div className="stat-value">{int(totals.calls)}</div>
        <div className="stat-sub">平均延遲 {int(totals.avgLatencyMs)}ms</div>
      </div>
      <div className="stat-card">
        <div className="stat-label">錯誤率</div>
        <div className={`stat-value ${errClass}`}>{pct(totals.errorRate)}</div>
        <div className="stat-sub">{int(totals.errorCount)} 次錯誤</div>
      </div>
      <div className="stat-card">
        <div className="stat-label">Token 用量</div>
        <div className="stat-value">{int(totals.inputTokens + totals.outputTokens)}</div>
        <div className="stat-sub">
          入 {int(totals.inputTokens)} · 出 {int(totals.outputTokens)}
        </div>
      </div>
    </div>
  );
}
