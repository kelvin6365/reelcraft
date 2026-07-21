"use client";
import type { UsageRowView } from "@/ui/types";
import { usd } from "./format";

// ② 按日成本 bar chart — 純 CSS bars（唔准加圖表庫）。
// rows come from GET /api/usage?groupBy=day, already chronological.
export function DailyCostChart({ rows }: { rows: UsageRowView[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">此區間內未有用量。</p>;

  const max = Math.max(...rows.map((r) => r.actualCostUsd), 0);
  const total = rows.reduce((sum, r) => sum + r.actualCostUsd, 0);
  const peak = rows.reduce((best, r) => (r.actualCostUsd > best.actualCostUsd ? r : best), rows[0]);
  const summaryId = "daily-cost-chart-summary";

  return (
    <div>
      <p id={summaryId} className="sr-only">
        {`按日成本圖，共 ${rows.length} 日，總成本 ${usd(total)}，最高單日 ${usd(peak.actualCostUsd)} 喺 ${peak.key.slice(5)}`}
      </p>
      <div className="relative">
        {max > 0 && (
          <div className="absolute inset-x-0 top-0 flex items-center gap-2">
            <span className="text-[10px] tabular-nums text-muted-foreground">{usd(max)}</span>
            <div className="h-px flex-1 bg-border" />
          </div>
        )}
        <div className="flex h-40 items-end gap-1" role="img" aria-label="按日成本圖" aria-describedby={summaryId}>
          {rows.map((r) => {
            const hasCost = r.actualCostUsd > 0;
            const h = max > 0 ? (r.actualCostUsd / max) * 100 : 0;
            const mmdd = r.key.slice(5); // MM-DD
            const isPeak = hasCost && r.key === peak.key;
            return (
              <div
                key={r.key}
                className="group flex min-w-0 flex-1 flex-col items-center gap-1.5"
                title={`${r.key} · ${usd(r.actualCostUsd)} · ${r.calls} calls`}
              >
                <div className="flex h-32 w-full flex-col items-center justify-end">
                  {isPeak && (
                    <span className="mb-0.5 text-[10px] tabular-nums text-muted-foreground">{usd(r.actualCostUsd)}</span>
                  )}
                  {hasCost ? (
                    <div
                      className="w-full rounded-t-sm bg-primary/70 transition-colors group-hover:bg-primary"
                      style={{ height: `${h}%` }}
                    />
                  ) : (
                    <div className="h-0.5 w-full rounded-t-sm bg-muted-foreground/30" />
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground">{mmdd}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
