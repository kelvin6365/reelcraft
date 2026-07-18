// Prompt loading + strict rendering (docs/tech/06-prompts.md, CLAUDE.md #7).
// Prompts live as files under prompts/; never inline in code. This is the ONLY
// way to turn a catalog entry into rendered text handed to callModel().
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Placeholder syntax: {name}, name starts with a letter/underscore. Kept in
// lock-step with scripts/guards/prompt-catalog-sync.mjs — same regex, same rule.
const PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

const PROMPTS_ROOT = join(process.cwd(), "prompts");
const CATALOG_PATH = join(PROMPTS_ROOT, "catalog.json");

export class PromptError extends Error {
  constructor(
    public code:
      | "PROMPT_NOT_FOUND"
      | "CATALOG_INVALID"
      | "VARIABLE_MISMATCH"
      | "TEMPLATE_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "PromptError";
  }
}

export interface CatalogEntry {
  id: string;
  path: string;
  version: string;
  variables: string[];
  description: string;
}

export interface BuiltPrompt {
  text: string;
  promptId: string;
  version: string;
}

interface Cached<T> {
  mtimeMs: number;
  value: T;
}

let catalogCache: Cached<Map<string, CatalogEntry>> | null = null;
const templateCache = new Map<string, Cached<string>>();

function loadCatalog(): Map<string, CatalogEntry> {
  const mtimeMs = statSync(CATALOG_PATH).mtimeMs;
  if (catalogCache && catalogCache.mtimeMs === mtimeMs) return catalogCache.value;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
  } catch (err) {
    throw new PromptError("CATALOG_INVALID", `catalog.json is not valid JSON: ${String(err)}`);
  }
  const prompts = (raw as { prompts?: unknown })?.prompts;
  if (!Array.isArray(prompts)) {
    throw new PromptError("CATALOG_INVALID", "catalog.json must have a prompts[] array");
  }

  const map = new Map<string, CatalogEntry>();
  for (const entry of prompts as CatalogEntry[]) {
    if (!entry.id || !entry.path || !entry.version || !Array.isArray(entry.variables)) {
      throw new PromptError("CATALOG_INVALID", `catalog entry missing required fields: ${JSON.stringify(entry)}`);
    }
    map.set(entry.id, entry);
  }
  catalogCache = { mtimeMs, value: map };
  return map;
}

function loadTemplate(entryPath: string): string {
  const abs = join(PROMPTS_ROOT, entryPath);
  const mtimeMs = statSync(abs).mtimeMs;
  const cached = templateCache.get(abs);
  if (cached && cached.mtimeMs === mtimeMs) return cached.value;

  const value = readFileSync(abs, "utf8");
  templateCache.set(abs, { mtimeMs, value });
  return value;
}

function extractPlaceholders(template: string): Set<string> {
  const found = new Set<string>();
  for (const m of template.matchAll(PLACEHOLDER_RE)) found.add(m[1]);
  return found;
}

function sortedDiff(a: Set<string>, b: Set<string>): { missing: string[]; extra: string[] } {
  const missing = [...a].filter((k) => !b.has(k)).sort();
  const extra = [...b].filter((k) => !a.has(k)).sort();
  return { missing, extra };
}

/**
 * Render a catalog prompt with the given variables.
 *
 * Strict contract (throws PromptError on any breach):
 *   template placeholders === catalog.variables === provided keys.
 * The rendered text plus version is what the caller hands to callModel(),
 * which records promptId + promptVersion into AiCallLog.
 */
export function buildPrompt(promptId: string, variables: Record<string, string>): BuiltPrompt {
  const entry = loadCatalog().get(promptId);
  if (!entry) throw new PromptError("PROMPT_NOT_FOUND", `no catalog entry for promptId: ${promptId}`);

  const template = loadTemplate(entry.path);
  const templateVars = extractPlaceholders(template);
  const catalogVars = new Set(entry.variables);
  const providedVars = new Set(Object.keys(variables));

  // 1. template placeholders must match the catalog declaration.
  {
    const { missing, extra } = sortedDiff(catalogVars, templateVars);
    if (missing.length || extra.length) {
      throw new PromptError(
        "TEMPLATE_MISMATCH",
        `${promptId}: template placeholders differ from catalog variables` +
          (missing.length ? ` — declared but absent in template: [${missing.join(", ")}]` : "") +
          (extra.length ? ` — in template but not declared: [${extra.join(", ")}]` : ""),
      );
    }
  }

  // 2. provided keys must match the catalog declaration exactly.
  {
    const { missing, extra } = sortedDiff(catalogVars, providedVars);
    if (missing.length || extra.length) {
      throw new PromptError(
        "VARIABLE_MISMATCH",
        `${promptId}: provided variables differ from catalog` +
          (missing.length ? ` — missing: [${missing.join(", ")}]` : "") +
          (extra.length ? ` — unexpected: [${extra.join(", ")}]` : ""),
      );
    }
  }

  const text = template.replace(PLACEHOLDER_RE, (_full, name: string) => variables[name]);
  return { text, promptId: entry.id, version: entry.version };
}

// Test/tooling hook — drop caches so a fresh read is forced.
export function clearPromptCache(): void {
  catalogCache = null;
  templateCache.clear();
}
