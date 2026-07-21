// Usage dashboard data — rolls up ai_call_logs for the caller.
// spec: docs/tech/04-audit.md §用量 UI (M2). Query params:
//   from,to  ISO dates (default: last `days` days) — take precedence over `days` when given
//   days     7|30|90 (default: 30) — invalid/out-of-set values fall back to 30
//   groupBy  day|project|model|apiType|episode (default: day)
// Returns { rows, totals, errorTop, range }. Aggregation math lives in
// src/lib/usage.ts (pure, unit-tested). estCostUsd is null-safe: rows priced
// before the pricing catalog existed are surfaced as 未計價 (uncostedCalls).
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ok } from "@/lib/api/errors";
import { aggregateUsage, USAGE_GROUP_BYS, type UsageGroupBy, type UsageLogRow } from "@/lib/usage";

const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED_DAYS = [7, 30, 90] as const;
const DEFAULT_DAYS = 30;

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDays(raw: string | null): number {
  const n = Number(raw);
  return ALLOWED_DAYS.includes(n as (typeof ALLOWED_DAYS)[number]) ? n : DEFAULT_DAYS;
}

export const GET = withAuth(async ({ userId, req }) => {
  const sp = req.nextUrl.searchParams;

  const groupByRaw = sp.get("groupBy") ?? "day";
  const groupBy: UsageGroupBy = USAGE_GROUP_BYS.includes(groupByRaw as UsageGroupBy)
    ? (groupByRaw as UsageGroupBy)
    : "day";

  const days = parseDays(sp.get("days"));
  const to = parseDate(sp.get("to")) ?? new Date();
  const from = parseDate(sp.get("from")) ?? new Date(to.getTime() - days * DAY_MS);

  const raw = await prisma.aiCallLog.findMany({
    where: { userId, at: { gte: from, lte: to } },
    select: {
      at: true,
      modelKey: true,
      apiType: true,
      promptId: true,
      promptVersion: true,
      projectId: true,
      episodeId: true,
      inputTokens: true,
      outputTokens: true,
      cachedInputTokens: true,
      quantity: true,
      unit: true,
      estCostUsd: true,
      providerCostUsd: true,
      latencyMs: true,
      status: true,
      errorCode: true,
    },
  });

  // groupBy=episode needs the human episode number; ai_call_logs holds only
  // episodeId (no FK relation), so resolve numbers with one scoped lookup.
  let episodeNumbers: Map<string, number> | null = null;
  if (groupBy === "episode") {
    const ids = [...new Set(raw.map((r) => r.episodeId).filter((v): v is string => !!v))];
    if (ids.length > 0) {
      const eps = await prisma.episode.findMany({
        where: { userId, id: { in: ids } },
        select: { id: true, episodeNumber: true },
      });
      episodeNumbers = new Map(eps.map((e) => [e.id, e.episodeNumber]));
    }
  }

  const rows: UsageLogRow[] = raw.map((r) => ({
    at: r.at,
    modelKey: r.modelKey,
    apiType: r.apiType,
    promptId: r.promptId,
    promptVersion: r.promptVersion,
    projectId: r.projectId,
    episodeId: r.episodeId,
    episodeNumber: r.episodeId ? episodeNumbers?.get(r.episodeId) ?? null : null,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cachedInputTokens: r.cachedInputTokens,
    quantity: r.quantity,
    unit: r.unit,
    estCostUsd: r.estCostUsd == null ? null : Number(r.estCostUsd),
    providerCostUsd: r.providerCostUsd == null ? null : Number(r.providerCostUsd),
    latencyMs: r.latencyMs,
    status: r.status,
    errorCode: r.errorCode,
  }));

  const result = aggregateUsage(rows, groupBy);
  return ok({ ...result, range: { from: from.toISOString(), to: to.toISOString(), groupBy } });
});
