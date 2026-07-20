"use client";
import { useMemo, useState } from "react";
import type { UsageRowView } from "@/ui/types";
import { usd, int, ms, tokens } from "./format";

// ③ 按模型表 — sortable，預設按實際成本降序。
type SortKey = "actualCostUsd" | "estCostUsd" | "calls" | "tokens" | "avgLatencyMs";

// 偏差 = (實際 − 估算) / 估算，只計供應商有報實價嗰批 rows（apples-to-apples）。
function drift(r: UsageRowView): number | null {
  if (r.providerCostedCalls === 0 || r.estCostOnProviderCostedUsd <= 0) return null;
  return (r.providerCostUsd - r.estCostOnProviderCostedUsd) / r.estCostOnProviderCostedUsd;
}

export function ModelTable({ rows }: { rows: UsageRowView[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("actualCostUsd");

  const sorted = useMemo(() => {
    const val = (r: UsageRowView) => (sortKey === "tokens" ? r.inputTokens + r.outputTokens : r[sortKey]);
    return [...rows].sort((a, b) => val(b) - val(a));
  }, [rows, sortKey]);

  if (rows.length === 0) return <p className="muted">未有模型用量。</p>;

  const th = (key: SortKey, label: string) => (
    <th className="num sortable" onClick={() => setSortKey(key)}>
      {label}
      {sortKey === key ? " ↓" : ""}
    </th>
  );

  return (
    <div className="tbl-wrap">
      <table className="usage">
        <thead>
          <tr>
            <th>模型</th>
            {th("calls", "呼叫")}
            {th("tokens", "Tokens")}
            {th("actualCostUsd", "實際成本")}
            {th("estCostUsd", "估算成本")}
            <th className="num">偏差</th>
            {th("avgLatencyMs", "平均延遲")}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const d = drift(r);
            return (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td className="num">{int(r.calls)}</td>
                <td className="num">{tokens(r.inputTokens + r.outputTokens)}</td>
                <td className="num">
                  {usd(r.actualCostUsd)}
                  {r.providerCostedCalls > 0 && <span className="faint">（{r.providerCostedCalls} 實報）</span>}
                </td>
                <td className="num">
                  {usd(r.estCostUsd)}
                  {r.uncostedCalls > 0 && <span className="faint">（{r.uncostedCalls} 未計價）</span>}
                </td>
                <td className="num">
                  {d == null ? "—" : <span className={Math.abs(d) > 0.05 ? "danger" : ""}>{(d >= 0 ? "+" : "") + (d * 100).toFixed(1)}%</span>}
                </td>
                <td className="num">{ms(r.avgLatencyMs)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
