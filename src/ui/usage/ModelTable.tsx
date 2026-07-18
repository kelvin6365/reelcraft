"use client";
import { useMemo, useState } from "react";
import type { UsageRowView } from "@/ui/types";
import { usd, int, ms, tokens } from "./format";

// ③ 按模型表 — sortable，預設按成本降序。
type SortKey = "estCostUsd" | "calls" | "tokens" | "avgLatencyMs";

export function ModelTable({ rows }: { rows: UsageRowView[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("estCostUsd");

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
            {th("estCostUsd", "成本")}
            {th("avgLatencyMs", "平均延遲")}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td className="num">{int(r.calls)}</td>
              <td className="num">{tokens(r.inputTokens + r.outputTokens)}</td>
              <td className="num">
                {usd(r.estCostUsd)}
                {r.uncostedCalls > 0 && <span className="faint">（{r.uncostedCalls} 未計價）</span>}
              </td>
              <td className="num">{ms(r.avgLatencyMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
