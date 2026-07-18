// Runs all guards + typecheck. Wired to CI and pre-commit (docs/tech/08-guards.md).
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const guards = readdirSync("scripts/guards")
  .filter((f) => f.endsWith(".mjs") && f !== "lib.mjs")
  .sort();

let failed = false;
for (const g of guards) {
  const r = spawnSync("node", [`scripts/guards/${g}`], { stdio: "inherit" });
  if (r.status !== 0) failed = true;
}

console.log("— tsc --noEmit —");
const tsc = spawnSync("npx", ["tsc", "--noEmit"], { stdio: "inherit" });
if (tsc.status !== 0) failed = true;

process.exit(failed ? 1 : 0);
