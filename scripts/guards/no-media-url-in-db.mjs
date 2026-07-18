// Guard: prisma schema must not contain *Url columns — media is *MediaId FK (CLAUDE.md #4).
// Why: stored URLs go stale/leak; MediaObject + signed URLs is the only path.
import { readFileSync } from "node:fs";
import { report } from "./lib.mjs";

const schema = readFileSync("prisma/schema.prisma", "utf8").split("\n");
const hits = [];
schema.forEach((line, i) => {
  const m = line.match(/^\s*(\w*[Uu]rl)\s+String/);
  if (m) hits.push(`prisma/schema.prisma:${i + 1}  ${line.trim()}`);
});
process.exit(report("no-media-url-in-db", hits) ? 0 : 1);
