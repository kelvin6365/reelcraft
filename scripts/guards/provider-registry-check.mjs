// Guard: the provider registry, the model catalog, and the system model-defaults
// stay mutually consistent, and the eliminated fake-fallback never creeps back
// (design doc 2026-07-19-provider-model-defaults, CLAUDE.md #3 & #8).
// Why: model-defaults resolution now bottoms out at real system defaults — a
// stray provider prefix, an unbacked system default, or a resurrected `fake::`
// fallback would silently route real work to a dev stub (or an unknown adapter).
// Pure Node (no TS imports); the known-provider list is a hardcoded mirror, same
// convention as the other guards.
import { readFileSync } from "node:fs";
import { report, walk, scan } from "./lib.mjs";

const CATALOG = "standards/capabilities.json";
const RESOLVE = "src/lib/model-defaults/resolve.ts";
// Mirror of PROVIDERS in src/lib/providers.ts (kept in sync by review, like the
// apiType/unit sets in capability-catalog-check).
const KNOWN_PROVIDERS = new Set(["openrouter", "fal", "atlascloud", "fake"]);

const hits = [];

// --- (a) every catalog modelKey's provider prefix is a known provider ---------
let catalog;
try {
  catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
} catch (err) {
  console.error(`✗ provider-registry-check — cannot read ${CATALOG}: ${String(err)}`);
  process.exit(1);
}
const catalogByKey = new Map();
if (Array.isArray(catalog)) {
  for (const e of catalog) {
    if (e && typeof e.modelKey === "string") {
      catalogByKey.set(e.modelKey, e);
      const provider = e.modelKey.slice(0, e.modelKey.indexOf("::"));
      if (!KNOWN_PROVIDERS.has(provider)) {
        hits.push(`catalog modelKey ${e.modelKey} has provider "${provider}" not in registry {${[...KNOWN_PROVIDERS].join(", ")}}`);
      }
    }
  }
}

// --- (b) every SYSTEM_MODEL_DEFAULTS value exists in the catalog w/ matching apiType
let resolveSrc;
try {
  resolveSrc = readFileSync(RESOLVE, "utf8");
} catch (err) {
  console.error(`✗ provider-registry-check — cannot read ${RESOLVE}: ${String(err)}`);
  process.exit(1);
}
const sysBlock = resolveSrc.match(/SYSTEM_MODEL_DEFAULTS[^{]*\{([^}]*)\}/);
if (!sysBlock) {
  hits.push(`could not locate SYSTEM_MODEL_DEFAULTS object literal in ${RESOLVE}`);
} else {
  const slots = [...sysBlock[1].matchAll(/(text|image|video|tts)\s*:\s*"([^"]+)"/g)];
  const seen = new Set();
  for (const [, apiType, modelKey] of slots) {
    seen.add(apiType);
    const entry = catalogByKey.get(modelKey);
    if (!entry) {
      hits.push(`SYSTEM_MODEL_DEFAULTS.${apiType}="${modelKey}" is not in ${CATALOG}`);
    } else if (entry.apiType !== apiType) {
      hits.push(`SYSTEM_MODEL_DEFAULTS.${apiType}="${modelKey}" is a ${entry.apiType} catalog entry, not ${apiType}`);
    }
  }
  for (const apiType of ["text", "image", "video", "tts"]) {
    if (!seen.has(apiType)) hits.push(`SYSTEM_MODEL_DEFAULTS is missing a ${apiType} slot`);
  }
}

// --- (c) no resurrected fake fallback in src ----------------------------------
const srcFiles = walk("src");
// fake::pipeline is a phantom key (catalog never had it) — the original bug.
for (const h of scan(srcFiles, (line) => line.includes("fake::pipeline"))) {
  hits.push(`fake::pipeline reference (phantom key, must not exist): ${h}`);
}
// `?? "fake::` (or single-quote) is the silent-downgrade pattern we removed. The
// only legitimate fake::* literals live in the resolver's explicit preset.
const fakeFallbackRe = /\?\?\s*["']fake::/;
const nonResolve = srcFiles.filter((f) => !f.endsWith("model-defaults/resolve.ts"));
for (const h of scan(nonResolve, (line) => fakeFallbackRe.test(line))) {
  hits.push(`fake fallback pattern (silent downgrade — CLAUDE.md #3): ${h}`);
}

process.exit(report("provider-registry-check", hits) ? 0 : 1);
