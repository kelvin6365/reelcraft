"use client";
import type { UsageRowView } from "@/ui/types";
import { usd, int } from "./format";

// ④ 按集成本表 — rows from GET /api/usage?groupBy=episode, cost desc.
export function EpisodeTable({ rows }: { rows: UsageRowView[] }) {
  if (rows.length === 0) return <p className="muted">未有分集用量。</p>;
  return (
    <div className="tbl-wrap">
      <table className="usage">
        <thead>
          <tr>
            <th>集</th>
            <th className="num">呼叫</th>
            <th className="num">成本</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td className="num">{int(r.calls)}</td>
              <td className="num">
                {usd(r.actualCostUsd)}
                {r.uncostedCalls > 0 && <span className="faint">（{r.uncostedCalls} 未計價）</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
