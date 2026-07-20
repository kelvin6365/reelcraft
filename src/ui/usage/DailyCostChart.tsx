"use client";
import type { UsageRowView } from "@/ui/types";
import { usd } from "./format";

// ② 按日成本 bar chart — 純 CSS bars（唔准加圖表庫）。
// rows come from GET /api/usage?groupBy=day, already chronological.
export function DailyCostChart({ rows }: { rows: UsageRowView[] }) {
  if (rows.length === 0) return <p className="muted">此區間內未有用量。</p>;
  const max = Math.max(...rows.map((r) => r.actualCostUsd), 0);

  return (
    <div className="barchart" role="img" aria-label="按日成本圖">
      {rows.map((r) => {
        const h = max > 0 ? (r.actualCostUsd / max) * 100 : 0;
        const mmdd = r.key.slice(5); // MM-DD
        return (
          <div key={r.key} className="bar-col" title={`${r.key} · ${usd(r.actualCostUsd)} · ${r.calls} calls`}>
            <div className="bar" style={{ height: `${h}%` }} />
            <div className="bar-x">{mmdd}</div>
          </div>
        );
      })}
    </div>
  );
}
