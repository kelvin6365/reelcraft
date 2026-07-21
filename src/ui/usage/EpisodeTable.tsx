"use client";
import type { UsageRowView } from "@/ui/types";
import { usd, int } from "./format";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// ④ 按集成本表 — rows from GET /api/usage?groupBy=episode, cost desc.
export function EpisodeTable({ rows }: { rows: UsageRowView[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">未有分集用量。</p>;
  return (
    <Card className="py-0">
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
                {usd(r.actualCostUsd)}
                {r.uncostedCalls > 0 && <span className="text-muted-foreground">（{r.uncostedCalls} 未計價）</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
