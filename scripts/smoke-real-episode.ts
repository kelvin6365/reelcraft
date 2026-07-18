// FULL REAL episode: the same guided pipeline as smoke-pipeline.ts but with
// real providers (OpenRouter text / fal image+video+tts). Costs real money
// (~US$9 at 6 shots × 5s Kling). Prints the total from AiCallLog at the end.
import { spawn } from "node:child_process";
import { prisma } from "../src/lib/db";
import { newId } from "../src/lib/ids";
import { submitTask } from "../src/lib/task/submit";
import { TASK_TYPE, type TaskType } from "../src/lib/task/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const REAL_MODELS = {
  text: "openrouter::google/gemini-2.5-flash",
  image: "fal::fal-ai/nano-banana",
  video: "fal::fal-ai/kling-video/v3/standard/image-to-video",
  tts: "fal::fal-ai/minimax/speech-02-hd",
};

const NOVEL = `雨夜，林知夏推開咖啡店的門，風鈴輕響。店裡只剩靠窗那一桌還亮著燈。
陳沉坐在那裡，面前的咖啡早就涼了。他抬起頭，兩人的目光在昏黃的燈光下相遇。
「你遲到了。」林知夏拉開椅子坐下，聲音比她想像中平靜。
「路上有事。」陳沉答得很短。
沉默在兩人之間蔓延。窗外的雨越下越大，把整條街的燈光都暈開了。
林知夏從包裡拿出一份文件，推到桌子中央。「簽了它，我們就兩清了。」
陳沉盯著那份文件，很久都沒有動。`;

async function waitTask(taskId: string, label: string, timeoutMs = 15 * 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { status: true, errorCode: true, errorMessage: true, progress: true } });
    if (t.status === "completed") return void console.log(`  ✓ ${label}`);
    if (t.status === "failed") throw new Error(`${label} FAILED: ${t.errorCode} ${t.errorMessage}`);
    await sleep(1500);
  }
  throw new Error(`${label} timeout`);
}

async function run(userId: string, projectId: string, episodeId: string, type: TaskType, targetType = "episode", targetId = episodeId): Promise<void> {
  const { taskId } = await submitTask({ userId, type, targetType, targetId, projectId, episodeId, payload: { at: Date.now() } });
  await waitTask(taskId, `${type}${targetType === "shot" ? ` ${targetId.slice(-4)}` : ""}`);
}

async function main() {
  console.log("[real-ep] spawning worker…");
  const worker = spawn("npx", ["tsx", "--env-file=.env", "src/lib/workers/index.ts"], { stdio: ["ignore", "ignore", "pipe"] });
  worker.stderr?.on("data", (d) => process.stderr.write(`  [w!] ${d}`));
  await sleep(3000);

  try {
    const email = "smoke@reelcraft.local";
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) user = await prisma.user.create({ data: { id: newId(), name: "smoke", email } });

    const project = await prisma.project.create({
      data: {
        id: newId(),
        userId: user.id,
        name: `真·首集 ${new Date().toISOString().slice(0, 16)}`,
        stylePackId: "cinematic-01",
        modelDefaults: REAL_MODELS,
      },
    });
    const episode = await prisma.episode.create({
      data: { id: newId(), userId: user.id, projectId: project.id, episodeNumber: 1, rawText: NOVEL },
    });
    console.log(`[real-ep] project ${project.id}\n[real-ep] models`, REAL_MODELS);

    await run(user.id, project.id, episode.id, TASK_TYPE.REWRITE_SCRIPT);
    await run(user.id, project.id, episode.id, TASK_TYPE.EXTRACT_ASSETS);

    for (const c of await prisma.character.findMany({ where: { projectId: project.id } })) {
      const { taskId } = await submitTask({ userId: user.id, type: TASK_TYPE.IMAGE_CHARACTER, targetType: "character", targetId: c.id, projectId: project.id });
      await waitTask(taskId, `IMAGE_CHARACTER ${c.name}`);
      const fresh = await prisma.character.findUniqueOrThrow({ where: { id: c.id } });
      await prisma.character.update({ where: { id: c.id }, data: { lockedImageMediaId: (fresh.candidates as string[])[0], locked: true } });
    }
    for (const l of await prisma.location.findMany({ where: { projectId: project.id } })) {
      const { taskId } = await submitTask({ userId: user.id, type: TASK_TYPE.IMAGE_LOCATION, targetType: "location", targetId: l.id, projectId: project.id });
      await waitTask(taskId, `IMAGE_LOCATION ${l.name}`);
      const fresh = await prisma.location.findUniqueOrThrow({ where: { id: l.id } });
      await prisma.location.update({ where: { id: l.id }, data: { lockedImageMediaId: (fresh.candidates as string[])[0], locked: true } });
    }
    console.log("  ✓ assets locked");

    await run(user.id, project.id, episode.id, TASK_TYPE.BUILD_SCENES);
    await run(user.id, project.id, episode.id, TASK_TYPE.STORYBOARD_RUN);

    const shots = await prisma.shot.findMany({ where: { episodeId: episode.id }, orderBy: { shotIndex: "asc" } });
    console.log(`[real-ep] ${shots.length} shots — est video cost ~$${(shots.length * 5 * 0.28).toFixed(2)}`);
    for (const sh of shots) {
      await run(user.id, project.id, episode.id, TASK_TYPE.IMAGE_SHOT, "shot", sh.id);
      await run(user.id, project.id, episode.id, TASK_TYPE.VIDEO_SHOT, "shot", sh.id);
    }

    await run(user.id, project.id, episode.id, TASK_TYPE.VOICE_ANALYZE);
    for (let i = 0; i < 200; i++) {
      const pending = await prisma.voiceLine.count({ where: { episodeId: episode.id, audioMediaId: null } });
      if (pending === 0) break;
      await sleep(1500);
    }
    console.log("  ✓ TTS done");

    await run(user.id, project.id, episode.id, TASK_TYPE.COMPOSE_EPISODE);

    const done = await prisma.episode.findUniqueOrThrow({ where: { id: episode.id }, include: { exportMedia: true } });
    const cost = await prisma.aiCallLog.aggregate({ where: { projectId: project.id }, _sum: { estCostUsd: true }, _count: true });
    console.log(`[real-ep] ✅ DONE`);
    console.log({
      exportKey: done.exportMedia?.storageKey,
      sizeMB: (Number(done.exportMedia?.sizeBytes ?? 0) / 1024 / 1024).toFixed(1),
      shots: shots.length,
      aiCalls: cost._count,
      totalCostUsd: String(cost._sum.estCostUsd),
    });
  } finally {
    worker.kill("SIGTERM");
    await prisma.$disconnect();
  }
  process.exit(0);
}

main().catch(async (err) => {
  console.error("[real-ep] ❌", err);
  await prisma.$disconnect();
  process.exit(1);
});
