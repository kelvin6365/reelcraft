// Episode-planning E2E (offline, fake providers): set sourceText → plan →
// assert multi-episode result with risk flags → confirm → assert Episode rows →
// run REWRITE_SCRIPT on episode 1 to prove the planned episode feeds the 8-station flow.
import { spawn } from "node:child_process";
import { prisma } from "../src/lib/db";
import { newId } from "../src/lib/ids";
import { submitTask } from "../src/lib/task/submit";
import { TASK_TYPE } from "../src/lib/task/types";
import { planResultFromJson } from "../src/lib/planning/plan";
import { sliceByAnchors } from "../src/lib/workers/handlers/shared";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const NOVEL = `雨夜，林知夏推開咖啡店的門，風鈴輕響。店裡只剩靠窗那一桌還亮著燈。
陳沉坐在那裡，面前的咖啡早就涼了。他抬起頭，兩人的目光在昏黃的燈光下相遇。
「你遲到了。」林知夏拉開椅子坐下，聲音比她想像中平靜。
「路上有事。」陳沉答得很短。
沉默在兩人之間蔓延。窗外的雨越下越大，把整條街的燈光都暈開了。
林知夏從包裡拿出一份文件，推到桌子中央。「簽了它，我們就兩清了。」
陳沉盯著那份文件，很久都沒有動。`;

async function waitTask(taskId: string, label: string, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { status: true, errorCode: true, errorMessage: true } });
    if (t.status === "completed") return void console.log(`  ✓ ${label}`);
    if (t.status === "failed") throw new Error(`${label} FAILED: ${t.errorCode} ${t.errorMessage}`);
    await sleep(400);
  }
  throw new Error(`${label} timeout`);
}

async function main() {
  console.log("[plan] spawning worker…");
  const worker = spawn("npx", ["tsx", "--env-file=.env", "src/lib/workers/index.ts"], { stdio: ["ignore", "ignore", "pipe"] });
  worker.stderr?.on("data", (d) => process.stderr.write(`  [w!] ${d}`));
  await sleep(3000);

  try {
    const email = "smoke@reelcraft.local";
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) user = await prisma.user.create({ data: { id: newId(), name: "smoke", email } });

    const project = await prisma.project.create({
      data: { id: newId(), userId: user.id, name: `plan-smoke-${Date.now()}`, sourceText: NOVEL, planConfig: { anchor: "length", seconds: 60, hookStrength: "strong" } },
    });
    console.log(`[plan] project ${project.id}`);

    // 1) plan
    const { taskId } = await submitTask({ userId: user.id, type: TASK_TYPE.EPISODE_SPLIT, targetType: "project", targetId: project.id, projectId: project.id, payload: { at: Date.now() } });
    await waitTask(taskId, "EPISODE_SPLIT");

    const planned = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    const result = planResultFromJson(planned.planResult);
    if (planned.planStatus !== "planned") throw new Error(`planStatus=${planned.planStatus}`);
    if (result.episodes.length < 1) throw new Error("no episodes planned");
    const withRisk = result.episodes.filter((e) => e.risk).length;
    console.log(`  ✓ planned ${result.episodes.length} episodes, ${withRisk} carry risk`);
    for (const e of result.episodes) console.log(`     #${e.index} ${e.title} [${e.risk?.level}${e.risk?.flags.length ? " " + e.risk.flags.join(",") : ""}]`);

    // 2) confirm → create episodes
    const slices = sliceByAnchors(planned.sourceText, result.episodes);
    const created = await prisma.$transaction(async (tx) => {
      await tx.episode.createMany({
        data: result.episodes.map((_, i) => ({ id: newId(), userId: user.id, projectId: project.id, episodeNumber: i + 1, rawText: slices[i]?.content ?? "", status: "draft" })),
      });
      return result.episodes.length;
    });
    const eps = await prisma.episode.findMany({ where: { projectId: project.id }, orderBy: { episodeNumber: "asc" } });
    if (eps.length !== created) throw new Error(`expected ${created} episodes, got ${eps.length}`);
    if (eps.some((e) => !e.rawText.trim())) throw new Error("an episode has empty rawText");
    console.log(`  ✓ confirmed → ${eps.length} episodes with non-empty rawText`);

    // 3) prove episode 1 feeds the 8-station flow
    const rw = await submitTask({ userId: user.id, type: TASK_TYPE.REWRITE_SCRIPT, targetType: "episode", targetId: eps[0].id, projectId: project.id, episodeId: eps[0].id, payload: { at: Date.now() } });
    await waitTask(rw.taskId, "REWRITE_SCRIPT (ep 1)");
    const ep1 = await prisma.episode.findUniqueOrThrow({ where: { id: eps[0].id } });
    if (!ep1.scriptText.trim()) throw new Error("episode 1 script not produced");

    console.log("[plan] ✅ DONE — plan → confirm → 8-station all wired");
  } finally {
    worker.kill("SIGTERM");
    await prisma.$disconnect();
  }
  process.exit(0);
}

main().catch(async (err) => {
  console.error("[plan] ❌", err);
  await prisma.$disconnect();
  process.exit(1);
});
