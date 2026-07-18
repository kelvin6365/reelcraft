// Guard: prompts/catalog.json ⇄ prompts/pipeline/** stay 1:1 and in sync, and
// canary samples render with their required constraint phrases intact (06-prompts.md, CLAUDE.md #7).
// Why: prompts are versioned assets — a drifted catalog, an orphan file, or a
// silently-weakened constraint (e.g. dropping the 0.5 emotion cap) must fail CI.
// Pure Node: read files + naive {var} substitution, no TS imports.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { report } from "./lib.mjs";

const ROOT = "prompts";
const CATALOG = join(ROOT, "catalog.json");
const PIPELINE_DIR = join(ROOT, "pipeline");
const CANARY_DIR = join(ROOT, "canary");

// Must match src/lib/prompts/build-prompt.ts PLACEHOLDER_RE exactly.
const PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

const hits = [];

function placeholders(text) {
  return new Set([...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]));
}
function render(text, vars) {
  return text.replace(PLACEHOLDER_RE, (full, name) => (name in vars ? vars[name] : full));
}
function diff(a, b) {
  return [...a].filter((x) => !b.has(x)).sort();
}

const catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
const entries = catalog.prompts ?? [];
const byId = new Map(entries.map((e) => [e.id, e]));

// 1. every catalog entry points at an existing file; declared vars match placeholders.
for (const e of entries) {
  const abs = join(ROOT, e.path);
  if (!existsSync(abs)) {
    hits.push(`catalog entry '${e.id}' → missing file ${e.path}`);
    continue;
  }
  if (!e.version) hits.push(`catalog entry '${e.id}' missing version`);
  const tpl = placeholders(readFileSync(abs, "utf8"));
  const decl = new Set(e.variables ?? []);
  const missingInTpl = diff(decl, tpl); // declared but not in template
  const missingInDecl = diff(tpl, decl); // in template but not declared
  if (missingInTpl.length) hits.push(`'${e.id}': declared vars not in template: [${missingInTpl.join(", ")}]`);
  if (missingInDecl.length) hits.push(`'${e.id}': template placeholders not declared: [${missingInDecl.join(", ")}]`);
}

// 2. every pipeline file has a catalog entry (1:1, no orphans).
const catalogPaths = new Set(entries.map((e) => e.path));
for (const f of readdirSync(PIPELINE_DIR)) {
  if (!f.endsWith(".txt")) continue;
  const rel = `pipeline/${f}`;
  if (!catalogPaths.has(rel)) hits.push(`pipeline file has no catalog entry: ${rel}`);
}

// 3. canary files render successfully and contain their mustContain phrases.
if (existsSync(CANARY_DIR)) {
  for (const f of readdirSync(CANARY_DIR)) {
    if (!f.endsWith(".canary.json")) continue;
    const canary = JSON.parse(readFileSync(join(CANARY_DIR, f), "utf8"));
    const entry = byId.get(canary.promptId);
    if (!entry) {
      hits.push(`canary '${f}' → unknown promptId '${canary.promptId}'`);
      continue;
    }
    const tplText = readFileSync(join(ROOT, entry.path), "utf8");
    const provided = new Set(Object.keys(canary.variables ?? {}));
    const decl = new Set(entry.variables ?? []);
    const missing = diff(decl, provided);
    const extra = diff(provided, decl);
    if (missing.length) hits.push(`canary '${f}': missing variables [${missing.join(", ")}]`);
    if (extra.length) hits.push(`canary '${f}': unexpected variables [${extra.join(", ")}]`);
    if (missing.length || extra.length) continue;

    const rendered = render(tplText, canary.variables);
    if (/\{[a-zA-Z_][a-zA-Z0-9_]*\}/.test(rendered)) {
      hits.push(`canary '${f}': rendered prompt still has unresolved placeholders`);
    }
    for (const phrase of canary.mustContain ?? []) {
      if (!rendered.includes(phrase)) hits.push(`canary '${f}': rendered prompt missing required phrase: "${phrase}"`);
    }
  }
}

process.exit(report("prompt-catalog-sync", hits) ? 0 : 1);
