// Runs all guards + typecheck (docs/tech/08-guards.md). 呢個 repo 而家未有 CI
// workflow 亦未裝 pre-commit hook —— 呢條命令係人手／agent 提交前自己跑嘅閘。
// 掛咗 CI 之後記得順手改返呢句同 README、08-guards 嗰兩處措辭。
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
