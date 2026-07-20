// Sync standards/capabilities.json text prices with OpenRouter's public models
// API (no key needed). Flat-priced media entries (fal/atlascloud) have no pricing
// API — they are reported for manual verification only, never auto-changed.
//
//   npm run sync:prices          apply diffs + stamp priceSource/priceVerifiedAt
//   npm run sync:prices:check    report drift only; exit 1 if any diff (CI-able)
//
// Never deletes or zeroes a price: delisted models are warned, not touched.
import { readFileSync, writeFileSync } from "node:fs";
import { computeOpenRouterDiffs, type CatalogEntryLike, type OpenRouterModelPricing } from "../src/lib/pricing/sync-openrouter";

const CATALOG_PATH = "standards/capabilities.json";
const MODELS_URL = "https://openrouter.ai/api/v1/models";

interface MutableEntry extends CatalogEntryLike {
  priceSource?: string;
  priceVerifiedAt?: string;
  [key: string]: unknown;
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");

  const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as MutableEntry[];

  const res = await fetch(MODELS_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    console.error(`✗ sync-prices: OpenRouter models API HTTP ${res.status}`);
    process.exit(1);
  }
  const body = (await res.json()) as { data?: { id?: string; pricing?: { prompt?: string; completion?: string } }[] };
  const models: OpenRouterModelPricing[] = (body.data ?? [])
    .filter((m): m is { id: string; pricing?: { prompt?: string; completion?: string } } => typeof m.id === "string")
    .map((m) => ({ id: m.id, pricing: m.pricing }));
  if (models.length === 0) {
    console.error("✗ sync-prices: OpenRouter models API returned no models — refusing to diff");
    process.exit(1);
  }

  const report = computeOpenRouterDiffs(catalog, models);

  if (report.diffs.length > 0) {
    console.log(`Price drift (${report.diffs.length}):`);
    for (const d of report.diffs) {
      console.log(`  ${d.modelKey} ${d.field}: ${d.current} → ${d.provider} USD/MTok`);
    }
  } else {
    console.log("No text price drift against OpenRouter.");
  }
  for (const k of report.notFound) console.warn(`⚠ not on OpenRouter list (delisted/renamed?) — left untouched: ${k}`);
  for (const k of report.malformed) console.warn(`⚠ malformed live pricing — left untouched: ${k}`);
  if (report.unsyncable.length > 0) {
    console.log("Manual-verify (no pricing API):");
    for (const k of report.unsyncable) {
      const entry = catalog.find((e) => e.modelKey === k);
      const p = entry?.pricing;
      const price = p?.mode === "flat" ? `$${p.perUnit}/${p.unit}` : `in $${p?.inputPerMTok} / out $${p?.outputPerMTok} per MTok`;
      const hint = k.startsWith("fal::") ? ` — verify at https://fal.ai/models/${k.slice("fal::".length)}` : "";
      const verified = entry?.priceVerifiedAt ? ` (last verified ${entry.priceVerifiedAt})` : "";
      console.log(`  ${k}: ${price}${verified}${hint}`);
    }
  }

  if (checkOnly) {
    process.exit(report.diffs.length > 0 ? 1 : 0);
  }

  // Apply: update drifted entries, stamp provenance on every openrouter entry we
  // saw live pricing for (changed or confirmed-unchanged).
  const today = new Date().toISOString().slice(0, 10);
  const stamped = new Set([...report.confirmed, ...report.diffs.map((d) => d.modelKey)]);
  for (const entry of catalog) {
    for (const d of report.diffs) {
      if (d.modelKey === entry.modelKey) entry.pricing[d.field] = d.provider;
    }
    if (stamped.has(entry.modelKey)) {
      entry.priceSource = "openrouter-api";
      entry.priceVerifiedAt = today;
    }
  }
  writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n");
  console.log(
    report.diffs.length > 0
      ? `✔ applied ${report.diffs.length} price change(s) to ${CATALOG_PATH}`
      : `✔ ${CATALOG_PATH} confirmed in sync; provenance stamped`,
  );
}

main().catch((err) => {
  console.error("✗ sync-prices failed:", err);
  process.exit(1);
});
