// Runs all guards + typecheck (docs/tech/08-guards.md)。GitHub Actions 每個 PR
// 都會跑呢條（.github/workflows/ci.yml 個 check job）。本機仲未裝 pre-commit
// hook，所以提交之前要人手／agent 自己行一次。
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
