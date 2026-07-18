// Guard: all AI calls go through src/lib/ai/call-model.ts (CLAUDE.md #2).
// Why: the single entry writes AiCallLog (audit hard requirement); bypasses = unaudited spend.
import { walk, scan, report } from "./lib.mjs";

const AI_DIR = "src/lib/ai";
const files = walk("src").filter((f) => !f.includes(AI_DIR));

const endpointHits = scan(files, (line) =>
  /queue\.fal\.run|openrouter\.ai|atlascloud\.(ai|com|cn)/i.test(line),
);
const importHits = scan(files, (line) =>
  /from\s+["'].*\/ai\/(adapters|provider-key)/.test(line),
);
const hits = [...endpointHits, ...importHits];
process.exit(report("no-ai-bypass", hits) ? 0 : 1);
