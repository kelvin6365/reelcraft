// Pure diff logic for syncing capabilities.json text prices against OpenRouter's
// public /api/v1/models pricing. No network/fs here — scripts/sync-prices.ts owns
// I/O; this module is unit-tested (tests/price-sync.test.ts).

// Loose catalog entry shape — the script reads capabilities.json directly (not
// through the zod loader) so it can still report on a mid-edit file.
export interface CatalogEntryLike {
  modelKey: string;
  apiType: string;
  pricing: {
    mode: string;
    inputPerMTok?: number;
    outputPerMTok?: number;
    perUnit?: number;
    unit?: string;
    currency?: string;
  };
}

export interface OpenRouterModelPricing {
  id: string;
  // USD-per-token strings, e.g. "0.0000003"
  pricing?: { prompt?: string; completion?: string };
}

export interface PriceDiff {
  modelKey: string;
  field: "inputPerMTok" | "outputPerMTok";
  current: number;
  provider: number;
}

export interface SyncReport {
  diffs: PriceDiff[];
  // openrouter:: entries confirmed unchanged against the live list
  confirmed: string[];
  // openrouter:: entries whose modelId is absent from the live list (delisted/renamed)
  notFound: string[];
  // openrouter:: entries with unparsable live pricing
  malformed: string[];
  // non-openrouter, non-fake entries — no pricing API, verify manually
  unsyncable: string[];
}

const TOLERANCE = 1e-8;

export function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

// "0.0000003" USD/token → 0.3 USD/MTok; null on malformed/negative.
export function perTokenStrToPerMTok(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return round8(n * 1e6);
}

export function computeOpenRouterDiffs(
  catalog: CatalogEntryLike[],
  models: OpenRouterModelPricing[],
): SyncReport {
  // first occurrence wins on duplicate ids
  const byId = new Map<string, OpenRouterModelPricing>();
  for (const m of models) if (!byId.has(m.id)) byId.set(m.id, m);

  const report: SyncReport = { diffs: [], confirmed: [], notFound: [], malformed: [], unsyncable: [] };

  for (const entry of catalog) {
    const sep = entry.modelKey.indexOf("::");
    if (sep < 0) continue;
    const provider = entry.modelKey.slice(0, sep);
    const modelId = entry.modelKey.slice(sep + 2);

    if (provider === "fake") continue;
    if (provider !== "openrouter") {
      report.unsyncable.push(entry.modelKey);
      continue;
    }
    if (entry.pricing.mode !== "text") {
      report.unsyncable.push(entry.modelKey);
      continue;
    }

    const live = byId.get(modelId);
    if (!live) {
      report.notFound.push(entry.modelKey);
      continue;
    }
    const input = perTokenStrToPerMTok(live.pricing?.prompt);
    const output = perTokenStrToPerMTok(live.pricing?.completion);
    if (input === null || output === null) {
      report.malformed.push(entry.modelKey);
      continue;
    }

    let changed = false;
    if (Math.abs((entry.pricing.inputPerMTok ?? 0) - input) > TOLERANCE) {
      report.diffs.push({ modelKey: entry.modelKey, field: "inputPerMTok", current: entry.pricing.inputPerMTok ?? 0, provider: input });
      changed = true;
    }
    if (Math.abs((entry.pricing.outputPerMTok ?? 0) - output) > TOLERANCE) {
      report.diffs.push({ modelKey: entry.modelKey, field: "outputPerMTok", current: entry.pricing.outputPerMTok ?? 0, provider: output });
      changed = true;
    }
    if (!changed) report.confirmed.push(entry.modelKey);
  }

  return report;
}
