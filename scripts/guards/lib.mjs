// Shared helpers for guard scripts (docs/tech/08-guards.md).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export function walk(dir, exts = [".ts", ".tsx"]) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

export function scan(files, matcher, { allowTag } = {}) {
  const hits = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (allowTag && line.includes(`guard-allow(${allowTag})`)) return;
      if (matcher(line, file)) hits.push(`${relative(process.cwd(), file)}:${i + 1}  ${line.trim().slice(0, 120)}`);
    });
  }
  return hits;
}

export function report(name, hits) {
  if (hits.length === 0) {
    console.log(`✓ ${name}`);
    return true;
  }
  console.error(`✗ ${name} — ${hits.length} violation(s):`);
  for (const h of hits) console.error(`   ${h}`);
  return false;
}
