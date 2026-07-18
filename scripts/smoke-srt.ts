// SRT-mode smoke (offline, fake providers): pasted SRT → SRT_BUILD (scene+shots+
// voice lines, deterministic) → confirm gate → shot images → shot videos → TTS per
// line → composed mp4. Proves M2-T3 end-to-end (no LLM for structure, no assets step).
// Run: npx tsx --env-file=.env scripts/smoke-srt.ts
import { spawn } from "node:child_process";
import { prisma } from "../src/lib/db";
import { newId } from "../src/lib/ids";
import { submitTask } from "../src/lib/task/submit";
import { TASK_TYPE, type TaskType } from "../src/lib/task/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SRT = `1
00:00:00,000 --> 00:00:03,200
雨夜，林知夏推開咖啡店的門。

2
00:00:03,200 --> 00:00:07,000
陳沉坐在靠窗那桌，咖啡早就涼了。

3
00:00:07,000 --> 00:00:10,500
「你遲到了。」她拉開椅子坐下。

4
00:00:10,500 --> 00:00:14,000
窗外的雨越下越大，暈開整條街的燈光。
`;

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
  console.log("[srt] spawning worker…");
  const worker = spawn("npx", ["tsx", "--env-file=.env", "src/lib/workers/index.ts"], { stdio: ["ignore", "ignore", "pipe"] });
  worker.stderr?.on("data", (d) => process.stderr.write(`  [w!] ${d}`));
  await sleep(3000);

  try {
    const email = "smoke-srt@reelcraft.local";
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) user = await prisma.user.create({ data: { id: newId(), name: "smoke-srt", email } });

    const project = await prisma.project.create({
      data: { id: newId(), userId: user.id, name: `srt-smoke-${Date.now()}`, stylePackId: "cinematic-01", inputType: "srt" },
    });
    const episode = await prisma.episode.create({
      data: { id: newId(), userId: user.id, projectId: project.id, episodeNumber: 1, rawText: SRT },
    });
    console.log(`[srt] project ${project.id} episode ${episode.id}`);

    // SRT mode: no script, no assets — subtitle cues build the structure directly.
    await run(user.id, project.id, episode.id, TASK_TYPE.SRT_BUILD);

    const shots = await prisma.shot.findMany({ where: { episodeId: episode.id }, orderBy: { shotIndex: "asc" } });
    const voiceLines = await prisma.voiceLine.findMany({ where: { episodeId: episode.id }, orderBy: { lineIndex: "asc" } });
    if (shots.length !== 4) throw new Error(`expected 4 shots, got ${shots.length}`);
    if (voiceLines.length !== 4) throw new Error(`expected 4 voice lines, got ${voiceLines.length}`);
    if (!voiceLines.every((v) => v.matchedShotId && v.speaker === "旁白")) throw new Error("voice lines not matched/narrated");
    console.log(`  ✓ SRT_BUILD → ${shots.length} shots, ${voiceLines.length} voice lines`);

    // ✋ storyboard confirm gate (direct DB update, mirrors POST /storyboard/confirm)
    await prisma.episode.update({ where: { id: episode.id }, data: { status: "images" } });

    for (const sh of shots) {
      await run(user.id, project.id, episode.id, TASK_TYPE.IMAGE_SHOT, "shot", sh.id);
      await run(user.id, project.id, episode.id, TASK_TYPE.VIDEO_SHOT, "shot", sh.id);
    }

    // tts-all: one TTS_LINE per line missing audio (SRT mode has no VOICE_ANALYZE)
    for (const line of voiceLines) {
      await run(user.id, project.id, episode.id, TASK_TYPE.TTS_LINE, "voiceLine", line.id);
    }
    const pendingTts = await prisma.voiceLine.count({ where: { episodeId: episode.id, audioMediaId: null } });
    if (pendingTts !== 0) throw new Error(`${pendingTts} voice lines still lack audio`);
    console.log("  ✓ TTS lines done");

    await run(user.id, project.id, episode.id, TASK_TYPE.COMPOSE_EPISODE, "episode", episode.id);

    const done = await prisma.episode.findUniqueOrThrow({ where: { id: episode.id }, include: { exportMedia: true } });
    if (!done.exportMediaId || !done.exportMedia) throw new Error("no export media");
    console.log(`[srt] ✅ episode composed — status=${done.status}`);
    console.log({
      exportKey: done.exportMedia.storageKey,
      sizeKB: Math.round(Number(done.exportMedia.sizeBytes) / 1024),
      shots: shots.length,
      voiceLines: voiceLines.length,
      aiCalls: await prisma.aiCallLog.count({ where: { projectId: project.id } }),
    });
    console.log(`[srt] play it: open data/storage/${done.exportMedia.storageKey}`);
  } finally {
    worker.kill("SIGTERM");
    await prisma.$disconnect();
  }
  process.exit(0);
}

main().catch(async (err) => {
  console.error("[srt] ❌", err);
  await prisma.$disconnect();
  process.exit(1);
});
