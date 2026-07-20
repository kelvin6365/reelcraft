// Full-pipeline smoke (offline, fake providers): novel text → script → assets →
// scenes → storyboard → shot images → shot videos → voice → TTS → composed mp4.
// Proves M1-T4 end-to-end. Run: npx tsx --env-file=.env scripts/smoke-pipeline.ts
import { spawn } from "node:child_process";
import { prisma } from "../src/lib/db";
import { newId } from "../src/lib/ids";
import { submitTask } from "../src/lib/task/submit";
import { TASK_TYPE, type TaskType } from "../src/lib/task/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const NOVEL = `雨夜，林知夏推開咖啡店的門，風鈴輕響。店裡只剩靠窗那一桌還亮著燈。
陳沉坐在那裡，面前的咖啡早就涼了。他抬起頭，兩人的目光在昏黃的燈光下相遇。
「你遲到了。」林知夏拉開椅子坐下，聲音比她想像中平靜。
「路上有事。」陳沉答得很短。
沉默在兩人之間蔓延。窗外的雨越下越大，把整條街的燈光都暈開了。
林知夏從包裡拿出一份文件，推到桌子中央。「簽了它，我們就兩清了。」
陳沉盯著那份文件，很久都沒有動。`;

async function waitTask(taskId: string, label: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { status: true, errorCode: true, errorMessage: true } });
    if (t.status === "completed") {
      console.log(`  ✓ ${label}`);
      return;
    }
    if (t.status === "failed") throw new Error(`${label} FAILED: ${t.errorCode} ${t.errorMessage}`);
    await sleep(400);
  }
  throw new Error(`${label} timeout`);
}

async function run(userId: string, projectId: string, episodeId: string, type: TaskType, targetType = "episode", targetId = episodeId): Promise<void> {
  const { taskId } = await submitTask({ userId, type, targetType, targetId, projectId, episodeId, payload: { at: Date.now() } });
  await waitTask(taskId, type);
}

async function main() {
  console.log("[pipeline] spawning worker…");
  const worker = spawn("npx", ["tsx", "--env-file=.env", "src/lib/workers/index.ts"], { stdio: ["ignore", "ignore", "pipe"] });
  worker.stderr?.on("data", (d) => process.stderr.write(`  [w!] ${d}`));
  await sleep(3000);

  try {
    const email = "smoke@reelcraft.local";
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) user = await prisma.user.create({ data: { id: newId(), name: "smoke", email } });

    const project = await prisma.project.create({
      data: { id: newId(), userId: user.id, name: `pipeline-smoke-${Date.now()}`, stylePackId: "cinematic-01" },
    });
    const episode = await prisma.episode.create({
      data: { id: newId(), userId: user.id, projectId: project.id, episodeNumber: 1, rawText: NOVEL },
    });
    console.log(`[pipeline] project ${project.id} episode ${episode.id}`);

    await run(user.id, project.id, episode.id, TASK_TYPE.REWRITE_SCRIPT);
    await run(user.id, project.id, episode.id, TASK_TYPE.SCRIPT_REVIEW);
    {
      const ep = await prisma.episode.findUniqueOrThrow({ where: { id: episode.id }, select: { scriptReview: true } });
      const review = ep.scriptReview as { scenes?: unknown[]; overall?: { note?: string } };
      if (!review.scenes?.length || !review.overall?.note) throw new Error("scriptReview empty after SCRIPT_REVIEW");
      console.log(`  ✓ scriptReview: ${review.scenes.length} scenes, overall=${(review.overall as { level?: string }).level}`);
    }
    await run(user.id, project.id, episode.id, TASK_TYPE.EXTRACT_ASSETS);

    // lock assets (simulating the ✋ review step: pick first candidate)
    for (const c of await prisma.character.findMany({ where: { projectId: project.id } })) {
      const { taskId } = await submitTask({ userId: user.id, type: TASK_TYPE.IMAGE_CHARACTER, targetType: "character", targetId: c.id, projectId: project.id });
      await waitTask(taskId, `IMAGE_CHARACTER ${c.name}`);
      const fresh = await prisma.character.findUniqueOrThrow({ where: { id: c.id } });
      const first = (fresh.candidates as string[])[0];
      await prisma.character.update({ where: { id: c.id }, data: { lockedImageMediaId: first, locked: true } });
    }
    console.log("  ✓ assets locked");

    await run(user.id, project.id, episode.id, TASK_TYPE.BUILD_SCENES);
    await run(user.id, project.id, episode.id, TASK_TYPE.STORYBOARD_RUN);

    for (const sh of await prisma.shot.findMany({ where: { episodeId: episode.id }, orderBy: { shotIndex: "asc" } })) {
      await run(user.id, project.id, episode.id, TASK_TYPE.IMAGE_SHOT, "shot", sh.id);
      await run(user.id, project.id, episode.id, TASK_TYPE.VIDEO_SHOT, "shot", sh.id);
    }

    await run(user.id, project.id, episode.id, TASK_TYPE.VOICE_ANALYZE);
    // VOICE_ANALYZE fans out TTS_LINE tasks — wait for them all
    for (let i = 0; i < 50; i++) {
      const pending = await prisma.voiceLine.count({ where: { episodeId: episode.id, audioMediaId: null } });
      if (pending === 0) break;
      await sleep(500);
    }
    console.log("  ✓ TTS lines done");

    await run(user.id, project.id, episode.id, TASK_TYPE.COMPOSE_EPISODE, "episode", episode.id);

    const done = await prisma.episode.findUniqueOrThrow({ where: { id: episode.id }, include: { exportMedia: true } });
    if (!done.exportMediaId || !done.exportMedia) throw new Error("no export media");
    console.log(`[pipeline] ✅ episode composed — status=${done.status}`);
    console.log({
      exportKey: done.exportMedia.storageKey,
      sizeKB: Math.round(Number(done.exportMedia.sizeBytes) / 1024),
      shots: await prisma.shot.count({ where: { episodeId: episode.id } }),
      voiceLines: await prisma.voiceLine.count({ where: { episodeId: episode.id } }),
      aiCalls: await prisma.aiCallLog.count({ where: { projectId: project.id } }),
    });
    console.log(`[pipeline] play it: open data/storage/${done.exportMedia.storageKey}`);
  } finally {
    worker.kill("SIGTERM");
    await prisma.$disconnect();
  }
  process.exit(0);
}

main().catch(async (err) => {
  console.error("[pipeline] ❌", err);
  await prisma.$disconnect();
  process.exit(1);
});
