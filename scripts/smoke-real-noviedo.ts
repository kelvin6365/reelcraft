// FULL REAL E2E, video skipped: real OpenRouter text (plan/script/assets/
// storyboard/voice) + real fal images + real MiniMax TTS, but NO VIDEO_SHOT —
// compose falls back to static image clips, so no Kling spend. Includes the new
// AI episode-planning step. Prints the total cost from AiCallLog.
import { spawn } from "node:child_process";
import { prisma } from "../src/lib/db";
import { newId } from "../src/lib/ids";
import { submitTask } from "../src/lib/task/submit";
import { TASK_TYPE, type TaskType } from "../src/lib/task/types";
import { planResultFromJson } from "../src/lib/planning/plan";
import { sliceByAnchors } from "../src/lib/workers/handlers/shared";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const REAL_MODELS = {
  text: "openrouter::google/gemini-2.5-flash",
  image: "fal::fal-ai/nano-banana",
  video: "fake::video", // skipped — never submitted; here only so config is valid
  tts: "fal::fal-ai/minimax/speech-02-hd",
};

const NOVEL = `雨夜，林知夏推開咖啡店的門，風鈴輕響。店裡只剩靠窗那一桌還亮著燈。
陳沉坐在那裡，面前的咖啡早就涼了。他抬起頭，兩人的目光在昏黃的燈光下相遇。
「你遲到了。」林知夏拉開椅子坐下，聲音比她想像中平靜。
「路上有事。」陳沉答得很短。
沉默在兩人之間蔓延。窗外的雨越下越大，把整條街的燈光都暈開了。
林知夏從包裡拿出一份文件，推到桌子中央。「簽了它，我們就兩清了。」
陳沉盯著那份文件，很久都沒有動。她站起身，留下最後一句：「我等你到明天。」`;

async function waitTask(taskId: string, label: string, timeoutMs = 8 * 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { status: true, errorCode: true, errorMessage: true } });
    if (t.status === "completed") return void console.log(`  ✓ ${label}`);
    if (t.status === "failed") throw new Error(`${label} FAILED: ${t.errorCode} ${t.errorMessage}`);
    await sleep(1500);
  }
  throw new Error(`${label} timeout`);
}

async function run(userId: string, projectId: string, episodeId: string, type: TaskType, targetType = "episode", targetId = episodeId) {
  const { taskId } = await submitTask({ userId, type, targetType, targetId, projectId, episodeId, payload: { at: Date.now() } });
  await waitTask(taskId, `${type}${targetType === "shot" ? " " + targetId.slice(-4) : ""}`);
}

async function main() {
  console.log("[real-nov] spawning worker…");
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
        name: `真AI·跳視頻 ${new Date().toISOString().slice(11, 16)}`,
        stylePackId: "cinematic-01",
        modelDefaults: REAL_MODELS,
        sourceText: NOVEL,
        planConfig: { anchor: "count", count: 2, hookStrength: "strong" },
      },
    });
    console.log(`[real-nov] project ${project.id}  models`, { text: REAL_MODELS.text, image: REAL_MODELS.image, tts: REAL_MODELS.tts, video: "SKIPPED" });

    // 1) REAL AI planning
    const plan = await submitTask({ userId: user.id, type: TASK_TYPE.EPISODE_SPLIT, targetType: "project", targetId: project.id, projectId: project.id, payload: { at: Date.now() } });
    await waitTask(plan.taskId, "EPISODE_SPLIT (real)");
    const planned = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    const result = planResultFromJson(planned.planResult);
    console.log(`  ✓ planned ${result.episodes.length} episodes:`);
    for (const e of result.episodes) console.log(`     #${e.index} ${e.title} [${e.risk?.level}] hook: ${e.hook?.slice(0, 24)}`);

    // 2) confirm → episodes
    const slices = sliceByAnchors(planned.sourceText, result.episodes);
    await prisma.episode.createMany({
      data: result.episodes.map((_, i) => ({ id: newId(), userId: user.id, projectId: project.id, episodeNumber: i + 1, rawText: slices[i]?.content ?? "", status: "draft" })),
    });
    const eps = await prisma.episode.findMany({ where: { projectId: project.id }, orderBy: { episodeNumber: "asc" } });
    const ep = eps[0];
    console.log(`  ✓ confirmed ${eps.length} episodes — running episode 1 through the stations (video skipped)`);

    // 3) episode 1 eight-station, real, minus VIDEO_SHOT
    await run(user.id, project.id, ep.id, TASK_TYPE.REWRITE_SCRIPT);
    await run(user.id, project.id, ep.id, TASK_TYPE.EXTRACT_ASSETS);

    for (const c of await prisma.character.findMany({ where: { projectId: project.id } })) {
      const t = await submitTask({ userId: user.id, type: TASK_TYPE.IMAGE_CHARACTER, targetType: "character", targetId: c.id, projectId: project.id });
      await waitTask(t.taskId, `IMAGE_CHARACTER ${c.name}`);
      const fresh = await prisma.character.findUniqueOrThrow({ where: { id: c.id } });
      await prisma.character.update({ where: { id: c.id }, data: { lockedImageMediaId: (fresh.candidates as string[])[0], locked: true } });
    }
    for (const l of await prisma.location.findMany({ where: { projectId: project.id } })) {
      const t = await submitTask({ userId: user.id, type: TASK_TYPE.IMAGE_LOCATION, targetType: "location", targetId: l.id, projectId: project.id });
      await waitTask(t.taskId, `IMAGE_LOCATION ${l.name}`);
      const fresh = await prisma.location.findUniqueOrThrow({ where: { id: l.id } });
      await prisma.location.update({ where: { id: l.id }, data: { lockedImageMediaId: (fresh.candidates as string[])[0], locked: true } });
    }
    console.log("  ✓ assets locked (real fal images)");

    await run(user.id, project.id, ep.id, TASK_TYPE.BUILD_SCENES);
    await run(user.id, project.id, ep.id, TASK_TYPE.STORYBOARD_RUN);

    const shots = await prisma.shot.findMany({ where: { episodeId: ep.id }, orderBy: { shotIndex: "asc" } });
    console.log(`  · ${shots.length} shots — generating REAL images, SKIPPING video`);
    for (const sh of shots) {
      await run(user.id, project.id, ep.id, TASK_TYPE.IMAGE_SHOT, "shot", sh.id);
      // VIDEO_SHOT intentionally skipped
    }

    await run(user.id, project.id, ep.id, TASK_TYPE.VOICE_ANALYZE);
    for (let i = 0; i < 200; i++) {
      if ((await prisma.voiceLine.count({ where: { episodeId: ep.id, audioMediaId: null } })) === 0) break;
      await sleep(1500);
    }
    console.log("  ✓ TTS done (real MiniMax)");

    await run(user.id, project.id, ep.id, TASK_TYPE.COMPOSE_EPISODE); // image-fallback clips

    const done = await prisma.episode.findUniqueOrThrow({ where: { id: ep.id }, include: { exportMedia: true } });
    const cost = await prisma.aiCallLog.aggregate({ where: { projectId: project.id }, _sum: { estCostUsd: true }, _count: true });
    const byType = await prisma.aiCallLog.groupBy({ by: ["apiType"], where: { projectId: project.id }, _count: true, _sum: { estCostUsd: true } });
    console.log("[real-nov] ✅ DONE");
    console.log({
      account: email,
      project: project.name,
      exportKey: done.exportMedia?.storageKey,
      sizeMB: (Number(done.exportMedia?.sizeBytes ?? 0) / 1024 / 1024).toFixed(1),
      shots: shots.length,
      aiCalls: cost._count,
      totalCostUsd: String(cost._sum.estCostUsd),
    });
    console.log("  cost by type:", byType.map((b) => `${b.apiType}:${b._count}×=$${b._sum.estCostUsd ?? 0}`).join("  "));
  } finally {
    worker.kill("SIGTERM");
    await prisma.$disconnect();
  }
  process.exit(0);
}

main().catch(async (err) => {
  console.error("[real-nov] ❌", err);
  await prisma.$disconnect();
  process.exit(1);
});
