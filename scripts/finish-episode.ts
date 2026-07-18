// Finish an existing episode without further video spend:
// VOICE_ANALYZE → wait TTS → COMPOSE_EPISODE (image-fallback for videoless shots).
// Usage: npx tsx --env-file=.env scripts/finish-episode.ts <episodeId>
import { spawn } from "node:child_process";
import { prisma } from "../src/lib/db";
import { submitTask } from "../src/lib/task/submit";
import { TASK_TYPE } from "../src/lib/task/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitTask(taskId: string, label: string, timeoutMs = 10 * 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { status: true, errorCode: true, errorMessage: true } });
    if (t.status === "completed") return void console.log(`  ✓ ${label}`);
    if (t.status === "failed") throw new Error(`${label} FAILED: ${t.errorCode} ${t.errorMessage}`);
    await sleep(1500);
  }
  throw new Error(`${label} timeout`);
}

async function main() {
  const episodeId = process.argv[2];
  if (!episodeId) throw new Error("usage: finish-episode.ts <episodeId>");
  const episode = await prisma.episode.findUniqueOrThrow({ where: { id: episodeId } });

  console.log("[finish] spawning worker…");
  const worker = spawn("npx", ["tsx", "--env-file=.env", "src/lib/workers/index.ts"], { stdio: ["ignore", "ignore", "pipe"] });
  worker.stderr?.on("data", (d) => process.stderr.write(`  [w!] ${d}`));
  await sleep(3000);

  try {
    const existingLines = await prisma.voiceLine.count({ where: { episodeId } });
    if (existingLines === 0) {
      const va = await submitTask({
        userId: episode.userId, type: TASK_TYPE.VOICE_ANALYZE, targetType: "episode", targetId: episodeId,
        projectId: episode.projectId, episodeId, payload: { at: Date.now() },
      });
      await waitTask(va.taskId, "VOICE_ANALYZE");
    }
    for (let i = 0; i < 200; i++) {
      const pending = await prisma.voiceLine.count({ where: { episodeId, audioMediaId: null } });
      if (pending === 0) break;
      await sleep(1500);
    }
    console.log("  ✓ TTS done");

    const compose = await submitTask({
      userId: episode.userId, type: TASK_TYPE.COMPOSE_EPISODE, targetType: "episode", targetId: episodeId,
      projectId: episode.projectId, episodeId, payload: { at: Date.now() },
    });
    await waitTask(compose.taskId, "COMPOSE_EPISODE", 15 * 60_000);

    const done = await prisma.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { exportMedia: true } });
    const cost = await prisma.aiCallLog.aggregate({ where: { projectId: episode.projectId }, _sum: { estCostUsd: true }, _count: true });
    console.log("[finish] ✅", {
      exportKey: done.exportMedia?.storageKey,
      sizeMB: (Number(done.exportMedia?.sizeBytes ?? 0) / 1024 / 1024).toFixed(1),
      totalProjectCostUsd: String(cost._sum.estCostUsd),
      aiCalls: cost._count,
    });
  } finally {
    worker.kill("SIGTERM");
    await prisma.$disconnect();
  }
  process.exit(0);
}

main().catch(async (err) => {
  console.error("[finish] ❌", err);
  await prisma.$disconnect();
  process.exit(1);
});
