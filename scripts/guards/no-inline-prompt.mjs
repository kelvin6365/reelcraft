// Guard: no long CJK instruction strings in src/ — prompts live in prompts/ (CLAUDE.md #7).
// Why: inline prompts dodge the catalog, versioning, and canary regression.
import { walk, scan, report } from "./lib.mjs";

const files = walk("src");
const hits = scan(
  files,
  (line) => {
    const cjk = (line.match(/[一-鿿]/g) ?? []).length;
    return cjk > 40 && /你是|必須|输出|輸出|禁止/.test(line);
  },
  { allowTag: "no-inline-prompt" },
);
process.exit(report("no-inline-prompt", hits) ? 0 : 1);
