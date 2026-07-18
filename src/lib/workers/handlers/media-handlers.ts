// Media-queue handlers: asset/shot images, shot videos, TTS lines, episode compose.
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";
import { generateImage, generateTts, generateVideo } from "@/lib/ai/generate-media";
import { getStorage } from "@/lib/storage";
import { createMediaFromBuffer } from "@/lib/media/service";
import { composeShot, concatShots, imageToVideoClip, probeDurationMs } from "@/lib/video/ffmpeg";
import { TaskError } from "@/lib/task/types";
import type { TaskHandler } from "@/lib/workers/lifecycle";
import { getModelDefaults, loadEpisodeWithProject, textCallJson } from "@/lib/workers/handlers/shared";

interface StylePack {
  prefix?: string;
  negativePrompt?: string;
}

async function loadStyle(stylePackId: string): Promise<StylePack> {
  try {
    const raw = await readFile(join(process.cwd(), "prompts", "styles", stylePackId, "style.json"), "utf8");
    return JSON.parse(raw) as StylePack;
  } catch {
    return {};
  }
}

const CANDIDATE_COUNT = 3;

// Shared by IMAGE_CHARACTER / IMAGE_LOCATION: generate N candidates for an asset.
function assetImageHandler(kind: "character" | "location"): TaskHandler {
  return async ({ task, reportProgress }) => {
    const model = kind === "character" ? prisma.character : prisma.location;
    const row = await (model as typeof prisma.character).findFirst({ where: { id: task.targetId, userId: task.userId } });
    if (!row) throw new TaskError("NOT_FOUND", `${kind} ${task.targetId} not found`, false);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: row.projectId } });
    const models = getModelDefaults(project);
    const style = await loadStyle(project.stylePackId);

    const basePrompt = "appearancePrompt" in row && row.appearancePrompt ? row.appearancePrompt : ((row as { prompt?: string }).prompt ?? "");
    const fullPrompt = `${basePrompt}. ${style.prefix ?? ""}`.trim();

    const mediaIds: string[] = [];
    for (let i = 0; i < CANDIDATE_COUNT; i++) {
      const media = await generateImage(
        { userId: task.userId, taskId: task.id, projectId: project.id },
        {
          modelKey: models.image,
          prompt: `${fullPrompt} (variant ${i + 1})`,
          negativePrompt: style.negativePrompt,
          aspectRatio: "9:16",
          keyPrefix: `projects/${project.id}/${kind}s/${row.id}`,
        },
      );
      mediaIds.push(media.id);
      reportProgress(((i + 1) / CANDIDATE_COUNT) * 95);
    }

    await (model as typeof prisma.character).update({ where: { id: row.id }, data: { candidates: mediaIds } });
    return { candidates: mediaIds.length };
  };
}

export const imageCharacterHandler = assetImageHandler("character");
export const imageLocationHandler = assetImageHandler("location");

export const imageShotHandler: TaskHandler = async ({ task, reportProgress }) => {
  const shot = await prisma.shot.findFirst({ where: { id: task.targetId, userId: task.userId } });
  if (!shot) throw new TaskError("NOT_FOUND", `shot ${task.targetId} not found`, false);
  const { episode, project } = await loadEpisodeWithProject({ ...task, episodeId: shot.episodeId });
  const models = getModelDefaults(project);
  const style = await loadStyle(project.stylePackId);

  // locked assets referenced by name for consistency
  const characters = await prisma.character.findMany({ where: { projectId: project.id, locked: true } });
  const locations = await prisma.location.findMany({ where: { projectId: project.id, locked: true } });
  const lockedAssets = [
    ...characters.map((c) => `${c.name}: ${c.appearancePrompt}`),
    ...locations.map((l) => `${l.name}: ${l.prompt}`),
  ].join("\n");

  reportProgress(10);
  const out = await textCallJson(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id },
    models.text,
    "image_prompt_shot",
    {
      shot_json: JSON.stringify(shot.storyboardJson),
      locked_assets: lockedAssets || "（無鎖定資產）",
      style_suffix: style.prefix ?? "",
    },
  );

  reportProgress(40);
  const media = await generateImage(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id },
    {
      modelKey: models.image,
      prompt: out.prompt,
      negativePrompt: out.negativePrompt || style.negativePrompt,
      aspectRatio: project.videoRatio,
      keyPrefix: `projects/${project.id}/shots/${shot.id}`,
    },
  );

  await prisma.shot.update({
    where: { id: shot.id },
    data: { imagePrompt: out.prompt, imageMediaId: media.id, status: "ready" },
  });
  return { mediaId: media.id };
};

export const videoShotHandler: TaskHandler = async ({ task, reportProgress }) => {
  const shot = await prisma.shot.findFirst({ where: { id: task.targetId, userId: task.userId } });
  if (!shot) throw new TaskError("NOT_FOUND", `shot ${task.targetId} not found`, false);
  if (!shot.imageMediaId) throw new TaskError("NO_IMAGE", "generate the shot image first", false);
  const { episode, project } = await loadEpisodeWithProject({ ...task, episodeId: shot.episodeId });
  const models = getModelDefaults(project);

  const plan = (shot.storyboardJson as { plan?: { subject?: string } }).plan;
  const durationSec = Math.max(2, Math.round(shot.durationMs / 1000) || 3);

  reportProgress(20);
  const media = await generateVideo(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id },
    {
      modelKey: models.video,
      prompt: shot.videoPrompt || plan?.subject || shot.imagePrompt,
      sourceImageMediaId: shot.imageMediaId,
      durationSec,
      aspectRatio: project.videoRatio,
      keyPrefix: `projects/${project.id}/shots/${shot.id}`,
    },
  );

  await prisma.shot.update({ where: { id: shot.id }, data: { videoMediaId: media.id } });
  return { mediaId: media.id };
};

export const ttsLineHandler: TaskHandler = async ({ task }) => {
  const line = await prisma.voiceLine.findFirst({ where: { id: task.targetId, userId: task.userId } });
  if (!line) throw new TaskError("NOT_FOUND", `voiceLine ${task.targetId} not found`, false);
  const { project } = await loadEpisodeWithProject({ ...task, episodeId: line.episodeId });
  const models = getModelDefaults(project);

  const media = await generateTts(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: line.episodeId },
    {
      modelKey: models.tts,
      text: line.content,
      voiceId: undefined,
      emotionStrength: line.emotionStrength,
      keyPrefix: `projects/${project.id}/voice/${line.id}`,
    },
  );

  await prisma.voiceLine.update({ where: { id: line.id }, data: { audioMediaId: media.id } });
  return { mediaId: media.id };
};

export const composeEpisodeHandler: TaskHandler = async ({ task, reportProgress }) => {
  const { episode, project } = await loadEpisodeWithProject(task);
  const shots = await prisma.shot.findMany({
    where: { episodeId: episode.id },
    orderBy: { shotIndex: "asc" },
    include: { voiceLines: true },
  });
  if (shots.length === 0) throw new TaskError("NO_SHOTS", "nothing to compose", false);

  const storage = getStorage();
  const dir = await mkdtemp(join(tmpdir(), "rc-compose-"));
  try {
    const composedPaths: string[] = [];
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      let clipPath = join(dir, `src-${i}.mp4`);

      if (shot.videoMediaId) {
        const media = await prisma.mediaObject.findUniqueOrThrow({ where: { id: shot.videoMediaId } });
        await writeFile(clipPath, await storage.getObjectBuffer(media.storageKey));
      } else if (shot.imageMediaId) {
        const media = await prisma.mediaObject.findUniqueOrThrow({ where: { id: shot.imageMediaId } });
        const imgPath = join(dir, `img-${i}.png`);
        await writeFile(imgPath, await storage.getObjectBuffer(media.storageKey));
        await imageToVideoClip(imgPath, Math.max(2, Math.round(shot.durationMs / 1000) || 3), clipPath, project.videoRatio);
      } else {
        continue; // skip shots with no visual at all
      }

      const line = shot.voiceLines[0];
      let audioPath: string | undefined;
      if (line?.audioMediaId) {
        const media = await prisma.mediaObject.findUniqueOrThrow({ where: { id: line.audioMediaId } });
        audioPath = join(dir, `aud-${i}.m4a`);
        await writeFile(audioPath, await storage.getObjectBuffer(media.storageKey));
      }

      const outPath = join(dir, `composed-${i}.mp4`);
      await composeShot({ videoPath: clipPath, audioPath, subtitle: line?.content }, outPath);
      composedPaths.push(outPath);
      reportProgress((i / shots.length) * 80);
    }

    if (composedPaths.length === 0) throw new TaskError("NO_VISUALS", "no shots had image/video to compose", false);

    reportProgress(85);
    const finalPath = join(dir, "episode.mp4");
    await concatShots(composedPaths, finalPath);
    const durationMs = await probeDurationMs(finalPath);

    const media = await createMediaFromBuffer({
      userId: task.userId,
      buffer: await readFile(finalPath),
      mimeType: "video/mp4",
      keyPrefix: `projects/${project.id}/exports/${episode.id}`,
    });
    await prisma.episode.update({ where: { id: episode.id }, data: { exportMediaId: media.id, status: "done" } });
    return { mediaId: media.id, shots: composedPaths.length, durationMs };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
