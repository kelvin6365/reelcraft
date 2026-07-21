// fs-free placeholder utilities, shared by build-prompt.ts (system, server-only)
// and later client components (variable checklists). MUST NOT import node:fs —
// an fs import here would poison the browser bundle.

// Placeholder syntax: {name}, name starts with a letter/underscore. Kept in
// lock-step with scripts/guards/prompt-catalog-sync.mjs — same regex, same rule.
export const PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export function extractPlaceholders(template: string): Set<string> {
  const found = new Set<string>();
  for (const m of template.matchAll(PLACEHOLDER_RE)) found.add(m[1]);
  return found;
}

export function sortedDiff(a: Set<string>, b: Set<string>): { missing: string[]; extra: string[] } {
  const missing = [...a].filter((k) => !b.has(k)).sort();
  const extra = [...b].filter((k) => !a.has(k)).sort();
  return { missing, extra };
}

export interface OverrideCheckOk {
  ok: true;
  warnings: string[];
}
export interface OverrideCheckErr {
  ok: false;
  code: "PROMPT_OVERRIDE_INVALID";
  message: string;
  missing: string[];
  extra: string[];
}
export type OverrideCheck = OverrideCheckOk | OverrideCheckErr;

// Strict equality: an override's placeholder set must exactly equal the
// catalog-declared variable list. renderTemplate does `variables[name]`
// unguarded, so an undeclared `{foo}` would render the literal string
// "undefined" — this check is what stops that before render time.
export function checkOverridePlaceholders(declaredVars: string[], content: string): OverrideCheck {
  const declared = new Set(declaredVars);
  const found = extractPlaceholders(content);
  const { missing, extra } = sortedDiff(declared, found);
  if (missing.length === 0 && extra.length === 0) return { ok: true, warnings: [] };
  return {
    ok: false,
    code: "PROMPT_OVERRIDE_INVALID",
    message:
      `override placeholders differ from catalog variables` +
      (missing.length ? ` — missing: [${missing.join(", ")}]` : "") +
      (extra.length ? ` — unexpected: [${extra.join(", ")}]` : ""),
    missing,
    extra,
  };
}

// Pure, non-blocking heuristic: warn (never block) when the system template
// carries an explicit output-format instruction that the override appears to
// have dropped. A false negative here just means a missed warning, not a
// silent corruption — render-time strict placeholder checks are the real gate.
const FORMAT_MARKERS = [/JSON/, /```json/i, /輸出格式/, /只輸出/, /回傳/];

export function detectFormatDrop(systemTemplate: string, content: string): string[] {
  const systemLines = systemTemplate.split("\n").filter((line) => FORMAT_MARKERS.some((re) => re.test(line)));
  if (systemLines.length === 0) return [];
  const overrideHasAny = FORMAT_MARKERS.some((re) => re.test(content));
  if (overrideHasAny) return [];
  return ["可能刪咗輸出格式指示，覆寫版搵唔到 JSON／輸出格式相關字眼"];
}
