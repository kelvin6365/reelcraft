"use client";
import type { UsageTotalsView } from "@/ui/types";
import { usd, int, pct } from "./format";
import { Card, CardContent } from "@/components/ui/card";

// ① 總覽卡：30 日總成本、總 calls、錯誤率。
export function OverviewCards({ totals }: { totals: UsageTotalsView }) {
  const errClass = totals.errorRate > 0.1 ? "text-destructive" : "";
  const metrics = [
    {
      label: "實際成本（USD）",
      value: usd(totals.actualCostUsd),
      hint: `估算 ${usd(totals.estCostUsd)}${totals.uncostedCalls > 0 ? ` · ${int(totals.uncostedCalls)} 次未計價` : ""}`,
      valueClass: "",
    },
    {
      label: "總呼叫次數",
      value: int(totals.calls),
      hint: `平均延遲 ${int(totals.avgLatencyMs)}ms`,
      valueClass: "",
    },
    {
      label: "錯誤率",
      value: pct(totals.errorRate),
      hint: `${int(totals.errorCount)} 次錯誤`,
      valueClass: errClass,
    },
    {
      label: "Token 用量",
      value: int(totals.inputTokens + totals.outputTokens),
      hint: `入 ${int(totals.inputTokens)} · 出 ${int(totals.outputTokens)}`,
      valueClass: "",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {metrics.map((m) => (
        <Card key={m.label}>
          <CardContent className="space-y-1 p-6">
            <p className="text-sm text-muted-foreground">{m.label}</p>
            <p className={`text-2xl font-semibold tabular-nums ${m.valueClass}`}>{m.value}</p>
            <p className="text-xs text-muted-foreground">{m.hint}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
