// Guard: standards/capabilities.json is well-formed and every entry is keyed by a
// strict provider::modelId (docs/tech/03-provider-layer.md, CLAUDE.md #3 & #8).
// Why: this catalog is the ONLY source of unit prices for AiCallLog — a malformed
// entry or a loose model key silently corrupts billing snapshots. Pure Node (no
// TS imports); mirrors the zod schema in src/lib/ai/capabilities.ts.
import { readFileSync } from "node:fs";
import { report } from "./lib.mjs";

const CATALOG = "standards/capabilities.json";
const API_TYPES = new Set(["text", "image", "video", "tts"]);
const FLAT_UNITS = new Set(["image", "second", "character"]);
// provider::modelId — non-empty provider (no ':'), then '::', then non-empty id.
const MODEL_KEY_RE = /^[^:]+::.+$/;
const CAP_KEYS = new Set(["durationsSec", "resolutions", "aspectRatios", "modes"]);
const PRICE_SOURCES = new Set(["openrouter-api", "manual"]);

const hits = [];

let catalog;
try {
  catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
} catch (err) {
  console.error(`✗ capability-catalog-check — cannot read ${CATALOG}: ${String(err)}`);
  process.exit(1);
}

if (!Array.isArray(catalog)) {
  hits.push("root must be a JSON array");
} else {
  const seen = new Set();
  for (const [i, e] of catalog.entries()) {
    const at = `entry[${i}]`;
    if (typeof e !== "object" || e === null) {
      hits.push(`${at}: must be an object`);
      continue;
    }
    if (typeof e.modelKey !== "string" || !MODEL_KEY_RE.test(e.modelKey)) {
      hits.push(`${at}: modelKey must match provider::modelId, got ${JSON.stringify(e.modelKey)}`);
    } else if (seen.has(e.modelKey)) {
      hits.push(`${at}: duplicate modelKey ${e.modelKey}`);
    } else {
      seen.add(e.modelKey);
    }

    if (!API_TYPES.has(e.apiType)) hits.push(`${at} (${e.modelKey}): invalid apiType ${JSON.stringify(e.apiType)}`);

    if (e.capabilities !== undefined) {
      if (typeof e.capabilities !== "object" || e.capabilities === null || Array.isArray(e.capabilities)) {
        hits.push(`${at} (${e.modelKey}): capabilities must be an object`);
      } else {
        for (const k of Object.keys(e.capabilities)) {
          if (!CAP_KEYS.has(k)) hits.push(`${at} (${e.modelKey}): unknown capabilities key '${k}'`);
        }
      }
    }

    if (e.priceSource !== undefined && !PRICE_SOURCES.has(e.priceSource)) {
      hits.push(`${at} (${e.modelKey}): priceSource must be one of ${[...PRICE_SOURCES].join("/")}, got ${JSON.stringify(e.priceSource)}`);
    }
    if (e.priceVerifiedAt !== undefined && (typeof e.priceVerifiedAt !== "string" || Number.isNaN(Date.parse(e.priceVerifiedAt)))) {
      hits.push(`${at} (${e.modelKey}): priceVerifiedAt must be a parseable date string`);
    }

    const p = e.pricing;
    if (typeof p !== "object" || p === null) {
      hits.push(`${at} (${e.modelKey}): pricing missing`);
      continue;
    }
    if (p.currency !== "USD") hits.push(`${at} (${e.modelKey}): pricing.currency must be "USD"`);
    if (p.mode === "flat") {
      if (typeof p.perUnit !== "number" || p.perUnit < 0) hits.push(`${at} (${e.modelKey}): flat pricing.perUnit must be >= 0`);
      if (!FLAT_UNITS.has(p.unit)) hits.push(`${at} (${e.modelKey}): flat pricing.unit invalid ${JSON.stringify(p.unit)}`);
    } else if (p.mode === "text") {
      if (typeof p.inputPerMTok !== "number" || p.inputPerMTok < 0) hits.push(`${at} (${e.modelKey}): text pricing.inputPerMTok must be >= 0`);
      if (typeof p.outputPerMTok !== "number" || p.outputPerMTok < 0) hits.push(`${at} (${e.modelKey}): text pricing.outputPerMTok must be >= 0`);
    } else {
      hits.push(`${at} (${e.modelKey}): pricing.mode must be "flat" or "text", got ${JSON.stringify(p.mode)}`);
    }
  }
}

process.exit(report("capability-catalog-check", hits) ? 0 : 1);
