"use client";
import { Download } from "lucide-react";
import type { UsageRowView } from "@/ui/types";
import { usd, int, downloadCsv, toCsv } from "./format";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function exportEpisodesCsv(rows: UsageRowView[], days: number) {
  const headers = ["集", "呼叫", "成本 (USD)"];
  const csvRows = rows.map((r) => [r.label, r.calls, r.actualCostUsd.toFixed(4)]);
  downloadCsv(`reelcraft-usage-episodes-${days}d.csv`, toCsv(headers, csvRows));
}

// ④ 按集成本表 — rows from GET /api/usage?groupBy=episode, cost desc.
export function EpisodeTable({ rows, days }: { rows: UsageRowView[]; days: number }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">未有分集用量。</p>;
  return (
    <Card className="py-0">
      <div className="flex justify-end px-4 pt-4">
        <Button size="sm" variant="outline" onClick={() => exportEpisodesCsv(rows, days)}>
          <Download />
          匯出 CSV
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>集</TableHead>
            <TableHead className="text-right">呼叫</TableHead>
            <TableHead className="text-right">成本</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="font-medium">{r.label}</TableCell>
              <TableCell className="text-right tabular-nums">{int(r.calls)}</TableCell>
              <TableCell className="text-right tabular-nums">
                <span className="inline-flex items-center gap-1.5">
                  {usd(r.actualCostUsd)}
                  {r.uncostedCalls > 0 && (
                    <Badge variant="outline" className="font-normal text-muted-foreground">
                      {r.uncostedCalls} 未計價
                    </Badge>
                  )}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
