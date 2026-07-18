"use client";
import type { UsageRowView } from "@/ui/types";
import { usd, int, tokens } from "./format";

// Prompt token ranking — rows from GET /api/usage?groupBy=prompt, already
// sorted by token spend desc (邊支 prompt 食 token 最多).
export function PromptTable({ rows }: { rows: UsageRowView[] }) {
  if (rows.length === 0) return <p className="muted">未有 prompt 用量。</p>;
  return (
    <div className="tbl-wrap">
      <table className="usage">
        <thead>
          <tr>
            <th>Prompt</th>
            <th className="num">呼叫</th>
            <th className="num">入 Tokens</th>
            <th className="num">出 Tokens</th>
            <th className="num">總 Tokens</th>
            <th className="num">成本</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td className="num">{int(r.calls)}</td>
              <td className="num">{tokens(r.inputTokens)}</td>
              <td className="num">{tokens(r.outputTokens)}</td>
              <td className="num">{tokens(r.inputTokens + r.outputTokens)}</td>
              <td className="num">{usd(r.estCostUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
