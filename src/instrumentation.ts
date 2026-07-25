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

  console.log("▶ local 模式：worker 已內嵌（毋須 npm run worker）");
}
