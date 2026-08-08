// Embedded worker bootstrap for DEPLOY_MODE=local
// (docs/plans/2026-07-25-local-quickstart-design.md §3). Next.js calls
// register() once per server process start. Full mode is entirely untouched —
// it keeps using the separate `npm run worker` (+ watchdog) processes.
export async function register(): Promise<void> {
  // NEXT_RUNTIME is a Next.js-injected runtime flag (also fires for the edge
  // runtime and during build), not part of our app config surface — env.ts's
  // schema covers the latter, so this one raw read is exempt.
  if (process.env.NEXT_RUNTIME !== "nodejs") return; // guard-allow(no-raw-env)

  const { isLocalMode } = await import("@/lib/env");
  if (!isLocalMode()) return;

  const { startLocalWorker } = await import("@/lib/task/local-queue");
  startLocalWorker();

  // Side-effect import: starts the watchdog's own poll loop (orphan recovery +
  // zombie cleanup). Local mode has no separate `npm run watchdog` process, so
  // it rides along in the same embedded worker.
  await import("@/lib/workers/watchdog");

  // 關機交還：同 full 模式嘅 worker 一樣（src/lib/workers/index.ts），把在途
  // task 打返 queued 並重新入 queue，令重啟之後即刻接得返手，唔使等 heartbeat
  // timeout（90s）+ watchdog tick（30s）。
  // Best-effort：Next 自己可能喺我哋寫完 DB 之前就收咗檔，所以只係加快復原，
  // 唔取代 watchdog 兜底。once = 唔好重覆註冊（dev reload 會再叫 register）。
  const { releaseActiveTasks } = await import("@/lib/workers/lifecycle");
  const handOver = (signal: string) => {
    void releaseActiveTasks()
      .then((n) => {
        if (n > 0) console.log(`[local-queue] ${signal} — 交還咗 ${n} 個在途 task`);
      })
      .catch(() => {});
  };
  // ⚠️ 一定要經 globalThis 攞 process。Turbopack 會為 edge runtime 都編一份
  // instrumentation.ts，佢靜態掃到字面上嘅 `process.once` 就報「Node.js API
  // not supported in the Edge Runtime」兼令 edge 嗰份編譯失敗 —— 即使上面
  // NEXT_RUNTIME 個閘保證咗呢幾行永遠唔會喺 edge 行到。用 globalThis 索引就
  // 唔會被靜態匹配，node 行為完全一樣。
  const proc = (globalThis as { process?: NodeJS.Process }).process;
  proc?.once("SIGTERM", () => handOver("SIGTERM"));
  proc?.once("SIGINT", () => handOver("SIGINT"));

  console.log("▶ local 模式：worker 已內嵌（毋須 npm run worker）");
}
