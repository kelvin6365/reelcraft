// Task-system smoke: proves the M1 resilience acceptance —
// a task survives `kill -9` of its worker and completes on the next worker.
//
// Flow: spawn worker → submit TEST_ECHO (8s sleep) → wait until processing →
// kill -9 worker → run one watchdog pass (with shortened timeout) → spawn new
// worker → assert task completes.
import { spawn, type ChildProcess } from "node:child_process";
import { prisma } from "../src/lib/db";
import { newId } from "../src/lib/ids";
import { submitTask } from "../src/lib/task/submit";
import { TASK_TYPE } from "../src/lib/task/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function spawnWorker(): ChildProcess {
  const p = spawn("npx", ["tsx", "--env-file=.env", "src/lib/workers/index.ts"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  p.stdout?.on("data", (d) => process.stdout.write(`  [w] ${d}`));
  p.stderr?.on("data", (d) => process.stderr.write(`  [w!] ${d}`));
  return p;
}

async function waitForStatus(taskId: string, statuses: string[], timeoutMs: number): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await prisma.task.findUnique({ where: { id: taskId }, select: { status: true } });
    if (t && statuses.includes(t.status)) return t.status;
    await sleep(500);
  }
  const t = await prisma.task.findUnique({ where: { id: taskId }, select: { status: true } });
  throw new Error(`timeout waiting for ${statuses.join("/")}, current=${t?.status}`);
}

async function main() {
  const email = "smoke@reelcraft.local";
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) user = await prisma.user.create({ data: { id: newId(), name: "smoke", email } });

  console.log("[smoke-task] 1/6 spawning worker A…");
  let worker = spawnWorker();
  await sleep(3000);

  console.log("[smoke-task] 2/6 submitting TEST_ECHO (8s work)…");
  const { taskId } = await submitTask({
    userId: user.id,
    type: TASK_TYPE.TEST_ECHO,
    targetType: "smoke",
    targetId: newId(),
    payload: { sleepMs: 8000 },
  });

  console.log("[smoke-task] 3/6 waiting for processing…");
  await waitForStatus(taskId, ["processing"], 15_000);

  console.log("[smoke-task] 4/6 kill -9 worker A mid-task…");
  worker.kill("SIGKILL");
  await sleep(1500);

  console.log("[smoke-task] 5/6 simulating watchdog (mark stale → requeue)…");
  // Shortcut the 90s heartbeat window for the test, then run real watchdog logic once.
  await prisma.task.updateMany({
    where: { id: taskId, status: "processing" },
    data: { heartbeatAt: new Date(Date.now() - 10 * 60_000) },
  });
  const { execSync } = await import("node:child_process");
  execSync("npx tsx --env-file=.env scripts/watchdog-once.ts", { stdio: "inherit" });

  console.log("[smoke-task] 6/6 spawning worker B, waiting for completion…");
  worker = spawnWorker();
  const final = await waitForStatus(taskId, ["completed", "failed"], 30_000);
  worker.kill("SIGTERM");

  if (final !== "completed") throw new Error(`FAIL: task ended as ${final}`);
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  console.log(`[smoke-task] ✅ recovery acceptance passed — task ${taskId}`);
  console.log({ status: task.status, attempt: task.attempt, progress: task.progress });
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("[smoke-task] ❌", err);
  await prisma.$disconnect();
  process.exit(1);
});
