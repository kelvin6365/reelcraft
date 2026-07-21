"use client";
import type { UsageRowView } from "@/ui/types";
import { usd, int, tokens } from "./format";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Prompt token ranking — rows from GET /api/usage?groupBy=prompt, already
// sorted by token spend desc (邊支 prompt 食 token 最多).
export function PromptTable({ rows }: { rows: UsageRowView[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">未有 prompt 用量。</p>;
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Prompt</TableHead>
            <TableHead className="text-right">呼叫</TableHead>
            <TableHead className="text-right">入 Tokens</TableHead>
            <TableHead className="text-right">出 Tokens</TableHead>
            <TableHead className="text-right">總 Tokens</TableHead>
            <TableHead className="text-right">成本</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="font-medium">{r.label}</TableCell>
              <TableCell className="text-right tabular-nums">{int(r.calls)}</TableCell>
              <TableCell className="text-right tabular-nums">{tokens(r.inputTokens)}</TableCell>
              <TableCell className="text-right tabular-nums">{tokens(r.outputTokens)}</TableCell>
              <TableCell className="text-right tabular-nums">{tokens(r.inputTokens + r.outputTokens)}</TableCell>
              <TableCell className="text-right tabular-nums">{usd(r.actualCostUsd)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
