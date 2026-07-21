"use client";
import type { UsageRowView } from "@/ui/types";
import { usd } from "./format";

// ② 按日成本 bar chart — 純 CSS bars（唔准加圖表庫）。
// rows come from GET /api/usage?groupBy=day, already chronological.
export function DailyCostChart({ rows }: { rows: UsageRowView[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">此區間內未有用量。</p>;
  const max = Math.max(...rows.map((r) => r.actualCostUsd), 0);

  return (
    <div className="flex h-40 items-end gap-1" role="img" aria-label="按日成本圖">
      {rows.map((r) => {
        const h = max > 0 ? (r.actualCostUsd / max) * 100 : 0;
        const mmdd = r.key.slice(5); // MM-DD
        return (
          <div
            key={r.key}
            className="group flex min-w-0 flex-1 flex-col items-center gap-1.5"
            title={`${r.key} · ${usd(r.actualCostUsd)} · ${r.calls} calls`}
          >
            <div className="flex h-32 w-full items-end">
              <div
                className="w-full rounded-t-sm bg-primary/70 transition-colors group-hover:bg-primary"
                style={{ height: `${h}%` }}
              />
            </div>
            <div className="text-[10px] text-muted-foreground">{mmdd}</div>
          </div>
        );
      })}
    </div>
  );
}
