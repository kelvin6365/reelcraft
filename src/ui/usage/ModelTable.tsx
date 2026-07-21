"use client";
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import type { UsageRowView } from "@/ui/types";
import { usd, int, ms, tokens, downloadCsv, toCsv } from "./format";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ③ 按模型表 — sortable，預設按實際成本降序，同一 header 再撳一次可反轉方向。
type SortKey = "actualCostUsd" | "estCostUsd" | "calls" | "tokens" | "avgLatencyMs";
type SortDir = "asc" | "desc";

// 偏差 = (實際 − 估算) / 估算，只計供應商有報實價嗰批 rows（apples-to-apples）。
function drift(r: UsageRowView): number | null {
  if (r.providerCostedCalls === 0 || r.estCostOnProviderCostedUsd <= 0) return null;
  return (r.providerCostUsd - r.estCostOnProviderCostedUsd) / r.estCostOnProviderCostedUsd;
}

function exportModelsCsv(rows: UsageRowView[], days: number) {
  const headers = ["模型", "呼叫", "Input Tokens", "Output Tokens", "實際成本 (USD)", "估算成本 (USD)", "平均延遲 (ms)"];
  const csvRows = rows.map((r) => [
    r.label,
    r.calls,
    r.inputTokens,
    r.outputTokens,
    r.actualCostUsd.toFixed(4),
    r.estCostUsd.toFixed(4),
    Math.round(r.avgLatencyMs),
  ]);
  downloadCsv(`reelcraft-usage-models-${days}d.csv`, toCsv(headers, csvRows));
}

export function ModelTable({ rows, days }: { rows: UsageRowView[]; days: number }) {
  const [sortKey, setSortKey] = useState<SortKey>("actualCostUsd");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const val = (r: UsageRowView) => (sortKey === "tokens" ? r.inputTokens + r.outputTokens : r[sortKey]);
    const dirMul = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => (val(a) - val(b)) * dirMul);
  }, [rows, sortKey, sortDir]);

  if (rows.length === 0) return <p className="text-sm text-muted-foreground">未有模型用量。</p>;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const th = (key: SortKey, label: string) => (
    <TableHead className="cursor-pointer select-none text-right" onClick={() => toggleSort(key)}>
      {label}
      {sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
    </TableHead>
  );

  return (
    <Card className="py-0">
      <div className="flex justify-end px-4 pt-4">
        <Button size="sm" variant="outline" onClick={() => exportModelsCsv(sorted, days)}>
          <Download />
          匯出 CSV
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>模型</TableHead>
            {th("calls", "呼叫")}
            {th("tokens", "Tokens")}
            {th("actualCostUsd", "實際成本")}
            {th("estCostUsd", "估算成本")}
            <TableHead className="text-right" title="實報成本 vs 估算成本嘅差幅，正值代表實際貴過估算">
              偏差
            </TableHead>
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
                  <span className="inline-flex items-center gap-1.5">
                    {usd(r.actualCostUsd)}
                    {r.providerCostedCalls > 0 && (
                      <Badge variant="secondary" className="font-normal">
                        {r.providerCostedCalls} 實報
                      </Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <span className="inline-flex items-center gap-1.5">
                    {usd(r.estCostUsd)}
                    {r.uncostedCalls > 0 && (
                      <Badge variant="outline" className="font-normal text-muted-foreground">
                        {r.uncostedCalls} 未計價
                      </Badge>
                    )}
                  </span>
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
