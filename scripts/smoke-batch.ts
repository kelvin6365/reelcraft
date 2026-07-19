// Batch/season smoke (offline, fake providers — zero real AI spend): set up
// project assets once, then autorun TWO episodes end-to-end with zero manual
// steps. Proves BATCH-1's advance engine + lifecycle hook.
// Run: npx tsx --env-file=.env scripts/smoke-batch.ts
import { spawn } from "node:child_process";
import { prisma } from "../src/lib/db";
import { newId } from "../src/lib/ids";
import { submitTask } from "../src/lib/task/submit";
import { advanceEpisode } from "../src/lib/batch/advance";
import { TASK_TYPE, type TaskType } from "../src/lib/task/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const NOVELS = [
  `雨夜，林知夏推開咖啡店的門，風鈴輕響。陳沉坐在靠窗的位置，面前的咖啡早就涼了。
「你遲到了。」林知夏拉開椅子坐下。
「路上有事。」陳沉答得很短。
林知夏從包裡拿出一份文件，推到桌子中央。「簽了它，我們就兩清了。」`,
  `第二天清晨，陳沉站在咖啡店門口，手裡捏著那份沒簽的文件。
林知夏隔著玻璃看見他，猶豫了很久，還是開了門。
「我想再談一次。」陳沉說。
雨停了，陽光落在兩人之間的桌面上。`,
];

async function waitTask(taskId: string, label: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { status: true, errorCode: true, errorMessage: true } });
    if (t.status === "completed") return;
    if (t.status === "failed") throw new Error(`${label} FAILED: ${t.errorCode} ${t.errorMessage}`);
    await sleep(400);
  }
  throw new Error(`${label} timeout`);
}

async function run(userId: string, projectId: string, episodeId: string, type: TaskType, targetType = "episode", targetId = episodeId): Promise<void> {
  const { taskId } = await submitTask({ userId, type, targetType, targetId, projectId, episodeId, payload: { at: Date.now() } });
  await waitTask(taskId, type);
  console.log(`  ✓ ${type}`);
}

async function main() {
  console.log("[batch] spawning worker…");
  const worker = spawn("npx", ["tsx", "--env-file=.env", "src/lib/workers/index.ts"], { stdio: ["ignore", "ignore", "pipe"] });
  worker.stderr?.on("data", (d) => process.stderr.write(`  [w!] ${d}`));
  await sleep(3000);

  try {
    const email = "smoke@reelcraft.local";
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) user = await prisma.user.create({ data: { id: newId(), name: "smoke", email } });

    // No modelDefaults → every stage runs on fake:: providers (offline, free).
    const project = await prisma.project.create({
      data: { id: newId(), userId: user.id, name: `batch-smoke-${Date.now()}`, stylePackId: "cinematic-01" },
    });
    const episodes = await Promise.all(
      NOVELS.map((rawText, i) =>
        prisma.episode.create({
          data: { id: newId(), userId: user.id, projectId: project.id, episodeNumber: i + 1, rawText },
        }),
      ),
    );
    console.log(`[batch] project ${project.id}, episodes ${episodes.map((e) => e.episodeNumber).join(", ")}`);

    // --- One-time season setup (mirrors real product flow): script → extract →
    // asset images → lock. Batch requires locked assets as a precondition.
    console.log("[batch] season setup (assets)…");
    await run(user.id, project.id, episodes[0].id, TASK_TYPE.REWRITE_SCRIPT);
    await run(user.id, project.id, episodes[0].id, TASK_TYPE.EXTRACT_ASSETS);
    for (const c of await prisma.character.findMany({ where: { projectId: project.id } })) {
      const { taskId } = await submitTask({ userId: user.id, type: TASK_TYPE.IMAGE_CHARACTER, targetType: "character", targetId: c.id, projectId: project.id, episodeId: episodes[0].id });
      await waitTask(taskId, `IMAGE_CHARACTER ${c.name}`);
      const fresh = await prisma.character.findUniqueOrThrow({ where: { id: c.id } });
      await prisma.character.update({ where: { id: c.id }, data: { lockedImageMediaId: (fresh.candidates as string[])[0], locked: true } });
    }
    for (const l of await prisma.location.findMany({ where: { projectId: project.id } })) {
      const { taskId } = await submitTask({ userId: user.id, type: TASK_TYPE.IMAGE_LOCATION, targetType: "location", targetId: l.id, projectId: project.id, episodeId: episodes[0].id });
      await waitTask(taskId, `IMAGE_LOCATION ${l.name}`);
      const fresh = await prisma.location.findUniqueOrThrow({ where: { id: l.id } });
      await prisma.location.update({ where: { id: l.id }, data: { lockedImageMediaId: (fresh.candidates as string[])[0], locked: true } });
    }
    console.log("  ✓ assets locked");

    // --- Start the batch: autorun both episodes and kick once each. From here
    // the lifecycle hook drives everything — the script only observes.
    console.log("[batch] 🚀 starting batch (autoConfirmStoryboard, with video)…");
    await prisma.episode.updateMany({
      where: { id: { in: episodes.map((e) => e.id) } },
      data: { autorun: true, autorunConfig: { autoConfirmStoryboard: true, skipVideo: false } },
    });
    for (const e of episodes) console.log(`  kick ep${e.episodeNumber}: ${await advanceEpisode(e.id)}`);

    // --- Observe until both episodes have an export (or something fails).
    const deadline = Date.now() + 5 * 60_000;
    const lastStatus: Record<string, string> = {};
    while (Date.now() < deadline) {
      const eps = await prisma.episode.findMany({
        where: { id: { in: episodes.map((e) => e.id) } },
        select: { id: true, episodeNumber: true, status: true, exportMediaId: true, autorun: true },
        orderBy: { episodeNumber: "asc" },
      });
      for (const e of eps) {
        if (lastStatus[e.id] !== e.status) {
          lastStatus[e.id] = e.status;
          console.log(`  ep${e.episodeNumber} → ${e.status}`);
        }
      }
      const failed = await prisma.task.findFirst({
        where: { projectId: project.id, status: "failed" },
        select: { type: true, errorCode: true, errorMessage: true },
      });
      if (failed) throw new Error(`task failed mid-batch: ${failed.type} ${failed.errorCode} ${failed.errorMessage}`);
      if (eps.every((e) => e.exportMediaId)) {
        if (eps.some((e) => e.autorun)) throw new Error("exported but autorun flag not cleared");
        console.log(`[batch] ✅ both episodes composed with ZERO manual steps`);
        console.log({
          statuses: eps.map((e) => `ep${e.episodeNumber}:${e.status}`),
          tasks: await prisma.task.count({ where: { projectId: project.id } }),
          aiCalls: await prisma.aiCallLog.count({ where: { projectId: project.id } }),
        });
        return;
      }
      await sleep(1000);
    }
    throw new Error("batch timeout after 5 min");
  } finally {
    worker.kill("SIGTERM");
    await prisma.$disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("[batch] ❌", err);
    await prisma.$disconnect();
    process.exit(1);
  });
