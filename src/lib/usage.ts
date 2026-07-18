// Usage aggregation — pure, in-memory rollup of ai_call_logs rows.
// Kept provider/Prisma-free so it can be unit-tested with fixture rows
// (tests/usage-api.test.ts). The route (src/app/api/usage/route.ts) fetches
// rows, converts Decimal → number, then hands plain rows here.
// Spec: docs/tech/04-audit.md §用量 UI. estCostUsd may be null for calls made
// before a pricing catalog existed — those are counted as 未計價 (uncosted).

export type UsageGroupBy = "day" | "project" | "model" | "apiType" | "episode" | "prompt";

export const USAGE_GROUP_BYS: UsageGroupBy[] = ["day", "project", "model", "apiType", "episode", "prompt"];

// Plain, Prisma-free shape of one ai_call_logs row.
export interface UsageLogRow {
  at: Date;
  modelKey: string;
  apiType: string;
  promptId: string | null;
  promptVersion: string | null;
  projectId: string | null;
  episodeId: string | null;
  episodeNumber?: number | null; // joined by the route for groupBy=episode
  inputTokens: number | null;
  outputTokens: number | null;
  quantity: number | null;
  unit: string | null;
  estCostUsd: number | null;
  latencyMs: number;
  status: string;
  errorCode: string | null;
}

export interface UsageRow {
  key: string; // stable group identity (episodeId, modelKey, day, …)
  label: string; // display label (繁中 where synthesised)
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number; // sum of non-null costs only
  uncostedCalls: number; // calls whose estCostUsd was null (未計價)
  errorCount: number;
  avgLatencyMs: number;
  quantityByUnit: Record<string, number>;
}

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
  uncostedCalls: number;
  errorCount: number;
  avgLatencyMs: number;
  errorRate: number; // errorCount / calls, 0 when no calls
}

export interface UsageErrorRow {
  errorCode: string;
  count: number;
}

export interface UsageResult {
  rows: UsageRow[];
  totals: UsageTotals;
  errorTop: UsageErrorRow[];
}

// UTC day bucket, YYYY-MM-DD.
export function dayKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function groupKey(row: UsageLogRow, groupBy: UsageGroupBy): { key: string; label: string } {
  switch (groupBy) {
    case "day": {
      const k = dayKey(row.at);
      return { key: k, label: k };
    }
    case "project":
      return row.projectId ? { key: row.projectId, label: row.projectId } : { key: "__none__", label: "（無專案）" };
    case "model":
      return { key: row.modelKey || "__unknown__", label: row.modelKey || "（未知模型）" };
    case "apiType":
      return { key: row.apiType || "__unknown__", label: row.apiType || "（未知）" };
    case "episode": {
      if (!row.episodeId) return { key: "__none__", label: "（無集）" };
      const label = row.episodeNumber != null ? `第 ${row.episodeNumber} 集` : row.episodeId;
      return { key: row.episodeId, label };
    }
    case "prompt": {
      if (!row.promptId) return { key: "__none__", label: "（無 prompt）" };
      const key = row.promptVersion ? `${row.promptId}@${row.promptVersion}` : row.promptId;
      return { key, label: key };
    }
  }
}

interface Accum extends UsageRow {
  _latencySum: number;
}

function emptyAccum(key: string, label: string): Accum {
  return {
    key,
    label,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    estCostUsd: 0,
    uncostedCalls: 0,
    errorCount: 0,
    avgLatencyMs: 0,
    quantityByUnit: {},
    _latencySum: 0,
  };
}

function accumulate(acc: Accum, row: UsageLogRow): void {
  acc.calls += 1;
  acc.inputTokens += row.inputTokens ?? 0;
  acc.outputTokens += row.outputTokens ?? 0;
  if (row.estCostUsd == null) acc.uncostedCalls += 1;
  else acc.estCostUsd += row.estCostUsd;
  if (row.status === "error") acc.errorCount += 1;
  acc._latencySum += row.latencyMs ?? 0;
  if (row.unit && row.quantity != null) {
    acc.quantityByUnit[row.unit] = (acc.quantityByUnit[row.unit] ?? 0) + row.quantity;
  }
}

function finalize(acc: Accum): UsageRow {
  const avgLatencyMs = acc.calls > 0 ? Math.round(acc._latencySum / acc.calls) : 0;
  const { _latencySum: _drop, ...row } = acc;
  void _drop;
  return { ...row, avgLatencyMs, estCostUsd: round6(acc.estCostUsd) };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function aggregateUsage(rows: UsageLogRow[], groupBy: UsageGroupBy): UsageResult {
  const groups = new Map<string, Accum>();
  const totals = emptyAccum("__totals__", "總計");
  const errors = new Map<string, number>();

  for (const row of rows) {
    const { key, label } = groupKey(row, groupBy);
    let g = groups.get(key);
    if (!g) {
      g = emptyAccum(key, label);
      groups.set(key, g);
    }
    accumulate(g, row);
    accumulate(totals, row);
    if (row.status === "error") {
      const code = row.errorCode || "UNKNOWN";
      errors.set(code, (errors.get(code) ?? 0) + 1);
    }
  }

  const out = [...groups.values()].map(finalize);
  // day → chronological; prompt → token spend desc (邊支食 token 最多);
  // everything else → cost desc then calls desc.
  if (groupBy === "day") out.sort((a, b) => a.key.localeCompare(b.key));
  else if (groupBy === "prompt")
    out.sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens) || b.estCostUsd - a.estCostUsd);
  else out.sort((a, b) => b.estCostUsd - a.estCostUsd || b.calls - a.calls);

  const errorTop = [...errors.entries()]
    .map(([errorCode, count]) => ({ errorCode, count }))
    .sort((a, b) => b.count - a.count);

  const t = finalize(totals);
  return {
    rows: out,
    totals: {
      calls: t.calls,
      inputTokens: t.inputTokens,
      outputTokens: t.outputTokens,
      estCostUsd: t.estCostUsd,
      uncostedCalls: t.uncostedCalls,
      errorCount: t.errorCount,
      avgLatencyMs: t.avgLatencyMs,
      errorRate: t.calls > 0 ? t.errorCount / t.calls : 0,
    },
    errorTop,
  };
}
