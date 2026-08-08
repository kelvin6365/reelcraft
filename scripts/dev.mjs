#!/usr/bin/env node
// `npm run dev` entry point. Runs bootstrap first (mode auto-detect + infra/db
// setup — see scripts/bootstrap-dev.mjs), then launches the process(es) for
// the resolved DEPLOY_MODE:
//   full  -> `next dev` + `npm run worker` together via concurrently (unchanged).
//   local -> `next dev` alone — the worker is embedded in the web process via
//            src/instrumentation.ts, so a separate worker process is dead weight.
// docs/plans/2026-07-25-local-quickstart-design.md §1, §4.
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { main as bootstrap } from "./bootstrap-dev.mjs";

function readDeployMode() {
  if (!existsSync(".env")) return "full";
  const match = readFileSync(".env", "utf8").match(/^DEPLOY_MODE=(\w+)/m);
  return match ? match[1] : "full";
}

async function run() {
  await bootstrap();

  const mode = readDeployMode();

  const child =
    mode === "local"
      ? (() => {
          console.log("▶ local 模式 — 單一 process（worker 已內嵌）");
          return spawn("npx", ["next", "dev"], { stdio: "inherit" });
        })()
      : (() => {
          // WORKER_WATCH=0（即 `npm run dev:stable`）→ worker 唔行 tsx watch。
          // 跑真模型嘅長任務時用：watch 模式下改任何一個被 worker 傳遞 import 到
          // 嘅檔案都會 restart，tsx 只等 5 秒就硬殺。任務本身而家可以斷點續接
          // （src/lib/ai/request-journal.ts），但唔重啟梗係更順。
          const stable = process.env.WORKER_WATCH === "0";
          if (stable) console.log("▶ worker 唔 watch（WORKER_WATCH=0）— 改 worker code 要自己重啟");
          return spawn(
            "npx",
            ["concurrently", "-n", "web,worker", "-c", "blue,magenta", "next dev", stable ? "npm:worker:once" : "npm:worker"],
            { stdio: "inherit" }
          );
        })();

  const forwardSignal = (signal) => child.kill(signal);
  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
}

run();
