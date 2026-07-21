"use client";
import { useMemo, useState } from "react";
import type { UsageRowView } from "@/ui/types";
import { usd, int, ms, tokens } from "./format";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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

  if (rows.length === 0) return <p className="text-sm text-muted-foreground">未有模型用量。</p>;

  const th = (key: SortKey, label: string) => (
    <TableHead
      className="cursor-pointer select-none text-right"
      onClick={() => setSortKey(key)}
    >
      {label}
      {sortKey === key ? " ↓" : ""}
    </TableHead>
  );

  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>模型</TableHead>
            {th("calls", "呼叫")}
            {th("tokens", "Tokens")}
            {th("actualCostUsd", "實際成本")}
            {th("estCostUsd", "估算成本")}
            <TableHead className="text-right">偏差</TableHead>
            {th("avgLatencyMs", "平均延遲")}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r) => {
            const d = drift(r);
            return (
              <TableRow key={r.key}>
                <TableCell className="font-medium">{r.label}</TableCell>
                <TableCell className="text-right tabular-nums">{int(r.calls)}</TableCell>
                <TableCell className="text-right tabular-nums">{tokens(r.inputTokens + r.outputTokens)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {usd(r.actualCostUsd)}
                  {r.providerCostedCalls > 0 && (
                    <span className="text-muted-foreground">（{r.providerCostedCalls} 實報）</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {usd(r.estCostUsd)}
                  {r.uncostedCalls > 0 && <span className="text-muted-foreground">（{r.uncostedCalls} 未計價）</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {d == null ? (
                    "—"
                  ) : (
                    <span className={Math.abs(d) > 0.05 ? "text-destructive" : ""}>
                      {(d >= 0 ? "+" : "") + (d * 100).toFixed(1)}%
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{ms(r.avgLatencyMs)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
