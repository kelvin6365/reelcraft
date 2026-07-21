// Guard: workers/routes must resolve prompts through resolvePrompt (which
// layers user/project overrides + one-off text), not the system-only
// buildPrompt, and must never read prompt files directly off disk (CLAUDE.md
// #7 — prompts are versioned assets, not code).
// Why: bypassing resolvePrompt silently ignores a user's saved override /
// one-off rerun text, and reading prompts/pipeline or catalog.json directly
// dodges the catalog contract entirely.
import { existsSync } from "node:fs";
import { walk, scan, report } from "./lib.mjs";

const ALLOWLIST = ["src/lib/prompts/build-prompt.ts", "src/lib/prompts/resolve-prompt.ts"];

for (const f of ALLOWLIST) {
  if (!existsSync(f)) {
    console.error(`✗ prompt-resolve-check — allowlisted file missing (guard would go blind): ${f}`);
    process.exit(1);
  }
}

const files = walk("src").filter((f) => !ALLOWLIST.includes(f));

const buildPromptHits = scan(
  files,
  (line) => /import\s*\{[^}]*\bbuildPrompt\b[^}]*\}\s*from\s*["']@\/lib\/prompts\/build-prompt["']/.test(line),
  { allowTag: "prompt-resolve" },
);
const rawPathHits = scan(
  files,
  (line) => /prompts\/pipeline|prompts\/catalog\.json/.test(line),
  { allowTag: "prompt-resolve" },
);
const readFileHits = scan(
  files,
  (line) => /readFileSync\([^)]*prompts/.test(line),
  { allowTag: "prompt-resolve" },
);

const hits = [...buildPromptHits, ...rawPathHits, ...readFileHits];
process.exit(report("prompt-resolve-check", hits) ? 0 : 1);
