// Prompt loading + strict rendering (docs/tech/06-prompts.md, CLAUDE.md #7).
// Prompts live as files under prompts/; never inline in code. This is the ONLY
// way to turn a catalog entry into rendered text handed to callModel().
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { extractPlaceholders, PLACEHOLDER_RE, sortedDiff } from "@/lib/prompts/placeholders";

const PROMPTS_ROOT = join(process.cwd(), "prompts");
const CATALOG_PATH = join(PROMPTS_ROOT, "catalog.json");

export class PromptError extends Error {
  // Class field (not a constructor param) so `"retryable" in err` is true even
  // before the constructor body runs — classifyError (src/lib/task/types.ts)
  // relies on this to route PromptError to its own code, not UNKNOWN.
  readonly retryable = false;

  constructor(
    public code:
      | "PROMPT_NOT_FOUND"
      | "CATALOG_INVALID"
      | "VARIABLE_MISMATCH"
      | "TEMPLATE_MISMATCH"
      | "PROMPT_OVERRIDE_INVALID",
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

// Sync lookups so callers (e.g. resolve-prompt.ts) can inspect the catalog
// without paying for a render.
export function getCatalogEntry(promptId: string): CatalogEntry | null {
  return loadCatalog().get(promptId) ?? null;
}

export function listCatalog(): CatalogEntry[] {
  return [...loadCatalog().values()];
}

export function readSystemTemplate(promptId: string): { entry: CatalogEntry; template: string } {
  const entry = loadCatalog().get(promptId);
  if (!entry) throw new PromptError("PROMPT_NOT_FOUND", `no catalog entry for promptId: ${promptId}`);
  return { entry, template: loadTemplate(entry.path) };
}

/**
 * Strict render + validate core, shared by buildPrompt (system-only) and
 * resolvePrompt (system/user/project/oneoff).
 *
 * Strict contract (throws PromptError on any breach):
 *   template placeholders === declaredVars === provided keys.
 */
export function renderTemplate(
  promptId: string,
  template: string,
  declaredVars: string[],
  variables: Record<string, string>,
): string {
  const templateVars = extractPlaceholders(template);
  const catalogVars = new Set(declaredVars);
  const providedVars = new Set(Object.keys(variables));

  // 1. template placeholders must match the declared variable list.
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

  // 2. provided keys must match the declared variable list exactly.
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

  return template.replace(PLACEHOLDER_RE, (_full, name: string) => variables[name]);
}

/**
 * Render a catalog prompt (system layer only) with the given variables.
 * The rendered text plus version is what the caller hands to callModel(),
 * which records promptId + promptVersion into AiCallLog.
 */
export function buildPrompt(promptId: string, variables: Record<string, string>): BuiltPrompt {
  const { entry, template } = readSystemTemplate(promptId);
  const text = renderTemplate(promptId, template, entry.variables, variables);
  return { text, promptId: entry.id, version: entry.version };
}

// Test/tooling hook — drop caches so a fresh read is forced.
export function clearPromptCache(): void {
  catalogCache = null;
  templateCache.clear();
}
