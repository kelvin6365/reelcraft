import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";
import { generateImage, generateTts, generateVideo } from "@/lib/ai/generate-media";
import { getStorage } from "@/lib/storage";
import { createMediaFromBuffer } from "@/lib/media/service";
import { composeShot, concatAudio, concatShots, imageToVideoClip, probeDurationMs } from "@/lib/video/ffmpeg";
import { TaskError } from "@/lib/task/types";
import type { TaskHandler } from "@/lib/workers/lifecycle";
import { resolveTaskModels, loadEpisodeWithProject, textCallJson, promptOverridesFromTask } from "@/lib/workers/handlers/shared";
import { mergeNegatives } from "@/lib/prompts/negatives";
import { buildShotRefAssets, matchShotCharacters, pickShotLocation } from "@/lib/prompts/shot-assets";
import { buildAngleImagePrompt, buildAngleNegativePrompt, mergeAngleMediaId, type LocationAngle } from "@/lib/prompts/location-angles";

interface StylePack {
  prefix?: string;
  assetPrefix?: string;
  locationPrefix?: string;
  negativePrompt?: string;
  bannedWords?: string[];
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

function assetImageHandler(kind: "character" | "location"): TaskHandler {
  return async ({ task, reportProgress }) => {
    const model = kind === "character" ? prisma.character : prisma.location;
    const row = await (model as typeof prisma.character).findFirst({ where: { id: task.targetId, userId: task.userId } });
    if (!row) throw new TaskError("NOT_FOUND", `${kind} ${task.targetId} not found`, false);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: row.projectId } });
    const models = await resolveTaskModels(task, project);
    const style = await loadStyle(project.stylePackId);

    const basePrompt = "appearancePrompt" in row && row.appearancePrompt ? row.appearancePrompt : ((row as { prompt?: string }).prompt ?? "");

    if (kind === "character" && (task.payload as { face?: boolean }).face === true) {
      if (!row.lockedImageMediaId) throw new TaskError("NOT_LOCKED", "lock the turnaround before generating the face close-up", false);
      const facePrompt = [
        style.assetPrefix ?? style.prefix ?? "",
        basePrompt,
        "close-up head-and-shoulders portrait of the SAME character as the reference image — identical face, hairstyle and features. Front-facing, neutral calm expression, eyes looking at camera, clean pure white background, flat even studio lighting, sharp focus, no text, no labels, rich facial detail, high quality, 4K resolution",
      ].filter(Boolean).join(". ").trim();
      const media = await generateImage(
        { userId: task.userId, taskId: task.id, projectId: project.id },
        {
          modelKey: models.image,
          prompt: facePrompt,
          negativePrompt: style.negativePrompt,
          aspectRatio: "1:1",
          keyPrefix: `projects/${project.id}/characters/${row.id}`,
          referenceMediaIds: [row.lockedImageMediaId],
        },
      );
      await prisma.character.update({ where: { id: row.id }, data: { faceImageMediaId: media.id } });
      return { face: media.id };
    }
    if (kind === "location" && typeof (task.payload as { angle?: number }).angle === "number") {
      const angleIndex = (task.payload as { angle: number }).angle;
      if (!row.lockedImageMediaId) throw new TaskError("NOT_LOCKED", "lock the main image before generating an angle view", false);
      const angles = ((row as { angles?: unknown[] }).angles ?? []) as LocationAngle[];
      const angle = angles[angleIndex];
      if (!angle) throw new TaskError("ANGLE_OUT_OF_RANGE", `angle ${angleIndex} out of range for location ${row.id}`, false);
      const media = await generateImage(
        { userId: task.userId, taskId: task.id, projectId: project.id },
        {
          modelKey: models.image,
          prompt: buildAngleImagePrompt(basePrompt, angle, style),
          negativePrompt: buildAngleNegativePrompt(style),
          aspectRatio: "16:9",
          keyPrefix: `projects/${project.id}/locations/${row.id}`,
          referenceMediaIds: [row.lockedImageMediaId],
        },
      );
      // Re-read before writing back — the user may have edited an angle's
      // label/prompt mid-flight; merging into a fresh snapshot avoids clobbering that.
      const fresh = await prisma.location.findFirst({ where: { id: row.id, userId: task.userId } });
      if (!fresh) throw new TaskError("NOT_FOUND", `location ${row.id} not found`, false);
      const freshAngles = ((fresh as { angles?: unknown[] }).angles ?? []) as LocationAngle[];
      let nextAngles: LocationAngle[];
      try {
        nextAngles = mergeAngleMediaId(freshAngles, angleIndex, media.id);
      } catch {
        throw new TaskError("ANGLE_OUT_OF_RANGE", `angle ${angleIndex} out of range for location ${row.id}`, false);
      }
      await prisma.location.update({ where: { id: row.id }, data: { angles: nextAngles as unknown as Prisma.InputJsonValue } });
      return { angle: angleIndex, mediaId: media.id };
    }

    const refFraming =
      kind === "character"
        ? "character reference sheet in two stacked sections: TOP HALF is one large ultra-detailed head-and-shoulders face close-up of the character; BOTTOM HALF is a row of three full-body standing views of the SAME character — front view, side profile, and back view — evenly spaced, not overlapping. Identical face, hairstyle, outfit and body in every view. Strict visual alignment: identical height, facial-feature placement and clothing folds must match perfectly across all views. Full body visible in each bottom view, both hands fully visible and relaxed naturally at the sides. Clean pure white background, flat even studio lighting, sharp focus everywhere, no cast shadows, no text, no labels, no captions anywhere, clean composition, rich detail, high quality, 4K resolution"
        : "wide establishing reference view, unified perspective with consistent vanishing points, consistent logically-motivated lighting true to the scene's time of day, logically coherent spatial layout, empty scene with no people, no characters, no text, no labels, clean composition, rich environmental detail, high quality";
    const assetRatio = kind === "location" ? "16:9" : "9:16";
    const stylePart =
      kind === "location"
        ? (style.locationPrefix ?? style.assetPrefix ?? style.prefix ?? "")
        : (style.assetPrefix ?? style.prefix ?? "");
    // 墊臉 — user-uploaded reference face, only relevant to characters. Feeding
    // it alongside keepIdentity's lockedImage lets the model lock the face while
    // varying pose/outfit/style; see ref-face route for upload/removal.
    const refFace = kind === "character" ? row.refFaceMediaId : null;
    const keepIdentity = (task.payload as { keepIdentity?: boolean }).keepIdentity === true;
    const identityRef = keepIdentity && row.lockedImageMediaId ? row.lockedImageMediaId : null;
    const refs = [refFace, identityRef].filter((v): v is string => Boolean(v));

    const refFacePrompt = refFace
      ? refs.length > 1
        ? "The character's face MUST exactly match the face in the first reference image; outfit and overall style follow the second reference image."
        : "The character's face MUST exactly match the face in the reference image."
      : "";
    const refFaceNote = kind === "character" ? row.refFaceNote : "";
    const fullPrompt = [stylePart, basePrompt, refFraming, refFacePrompt, refFaceNote].filter(Boolean).join(". ").trim();
    const negativePrompt =
      kind === "location"
        ? [style.negativePrompt, "people, person, human figure, crowd, silhouette of a person"].filter(Boolean).join(", ")
        : style.negativePrompt;

    const mediaIds: string[] = [];
    for (let i = 0; i < CANDIDATE_COUNT; i++) {
      const media = await generateImage(
        { userId: task.userId, taskId: task.id, projectId: project.id },
        {
          modelKey: models.image,
          prompt: fullPrompt,
          negativePrompt,
          aspectRatio: assetRatio,
          keyPrefix: `projects/${project.id}/${kind}s/${row.id}`,
          referenceMediaIds: refs.length ? refs : undefined,
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

function formatBlocking(raw: unknown): string {
  const b = (raw ?? {}) as {
    cameraAxis?: string;
    positions?: { name: string; screenSide?: string; facing?: string; placement?: string }[];
    keyProps?: string[];
  };
  if (!b.cameraAxis && !b.positions?.length) return "（無空間契約——保持前後鏡頭的左右關係與視線方向一致，不越軸）";
  const side = (s?: string) => (s === "left" ? "畫面左" : s === "right" ? "畫面右" : "畫面中");
  const pos = (b.positions ?? [])
    .map((p) => `${p.name}=${side(p.screenSide)}${p.facing ? `、${p.facing}` : ""}${p.placement ? `、${p.placement}` : ""}`)
    .join("；");
  const props = b.keyProps?.length ? `；道具：${b.keyProps.join("、")}` : "";
  return `軸線：${b.cameraAxis || "不越軸"}；${pos}${props}`;
}

export const imageShotHandler: TaskHandler = async ({ task, reportProgress }) => {
  const shot = await prisma.shot.findFirst({ where: { id: task.targetId, userId: task.userId } });
  // Deleted before we could start (cancel raced the delete) — moot, not a failure.
  if (!shot) {
    console.warn(`[IMAGE_SHOT] shot ${task.targetId} gone before start — skipping`);
    return { skipped: "shot-deleted" };
  }
  const scene = await prisma.scene.findUnique({
    where: { id: shot.sceneId },
    select: { blocking: true, summary: true, content: true },
  });
  const { episode, project } = await loadEpisodeWithProject({ ...task, episodeId: shot.episodeId });
  const models = await resolveTaskModels(task, project);
  const style = await loadStyle(project.stylePackId);

  const lockedCharacters = await prisma.character.findMany({ where: { projectId: project.id, locked: true } });
  const lockedLocations = await prisma.location.findMany({ where: { projectId: project.id, locked: true } });

  const plan = (shot.storyboardJson as { plan?: { characters?: string[] } }).plan;
  const shotCharNames = plan?.characters ?? [];
  const shotCharacters = matchShotCharacters(
    shotCharNames,
    lockedCharacters.map((c) => ({ name: c.name, aliases: c.aliases as string[] })),
  ).map((m) => lockedCharacters.find((c) => c.name === m.name)!);
  const shotLocation = pickShotLocation(`${scene?.summary ?? ""}\n${scene?.content ?? ""}`, lockedLocations);

  const refAssets = buildShotRefAssets(shotCharacters, shotLocation);
  const referenceMediaIds = refAssets.map((a) => a.mediaId);
  const referenceLegend = refAssets.map((a, i) => `图片${i + 1}=${a.label}`).join("；") || "（無參考圖）";
  const lockedAssets = refAssets.map((a, i) => `图片${i + 1}（${a.label}）: ${a.prompt}`).join("\n") || "（無鎖定資產）";

  reportProgress(10);
  const out = await textCallJson(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id, oneOff: promptOverridesFromTask(task) },
    models.text,
    "image_prompt_shot",
    {
      shot_json: JSON.stringify(shot.storyboardJson),
      scene_blocking: formatBlocking(scene?.blocking),
      locked_assets: lockedAssets,
      reference_legend: referenceLegend,
      style_suffix: style.prefix ?? "",
    },
  );

  reportProgress(40);
  const media = await generateImage(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id },
    {
      modelKey: models.image,
      prompt: out.prompt,
      negativePrompt: mergeNegatives(out.negativePrompt, style.negativePrompt, style.bannedWords),
      aspectRatio: project.videoRatio,
      keyPrefix: `projects/${project.id}/shots/${shot.id}`,
      referenceMediaIds,
    },
  );

  // updateMany, not update: the shot can be deleted (蒙太奇刪鏡 / storyboard regen)
  // during the generation window. A vanished shot is not a failure — the user
  // removed it — so complete quietly rather than crashing on "record not found".
  const saved = await prisma.shot.updateMany({
    where: { id: shot.id },
    data: { imagePrompt: out.prompt, imageMediaId: media.id, status: "ready" },
  });
  if (saved.count === 0) {
    console.warn(`[IMAGE_SHOT] shot ${shot.id} deleted mid-generation — media ${media.id} orphaned`);
    return { skipped: "shot-deleted" };
  }
  return { mediaId: media.id };
};

export const videoShotHandler: TaskHandler = async ({ task, reportProgress }) => {
  const shot = await prisma.shot.findFirst({ where: { id: task.targetId, userId: task.userId } });
  if (!shot) {
    console.warn(`[VIDEO_SHOT] shot ${task.targetId} gone before start — skipping`);
    return { skipped: "shot-deleted" };
  }
  if (!shot.imageMediaId) throw new TaskError("NO_IMAGE", "generate the shot image first", false);
  const { episode, project } = await loadEpisodeWithProject({ ...task, episodeId: shot.episodeId });
  const models = await resolveTaskModels(task, project);

  const sb = shot.storyboardJson as { plan?: { subject?: string }; detail?: { video_prompt?: string } };
  const durationSec = Math.max(2, Math.round(shot.durationMs / 1000) || 3);
  const videoPrompt = shot.videoPrompt || sb.detail?.video_prompt || sb.plan?.subject || shot.imagePrompt;

  reportProgress(20);
  const media = await generateVideo(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id },
    {
      modelKey: models.video,
      prompt: videoPrompt,
      sourceImageMediaId: shot.imageMediaId,
      durationSec,
      aspectRatio: project.videoRatio,
      keyPrefix: `projects/${project.id}/shots/${shot.id}`,
    },
  );

  const saved = await prisma.shot.updateMany({ where: { id: shot.id }, data: { videoMediaId: media.id } });
  if (saved.count === 0) {
    console.warn(`[VIDEO_SHOT] shot ${shot.id} deleted mid-generation — media ${media.id} orphaned`);
    return { skipped: "shot-deleted" };
  }
  return { mediaId: media.id };
};

export const ttsLineHandler: TaskHandler = async ({ task }) => {
  const line = await prisma.voiceLine.findFirst({ where: { id: task.targetId, userId: task.userId } });
  if (!line) throw new TaskError("NOT_FOUND", `voiceLine ${task.targetId} not found`, false);
  const { project } = await loadEpisodeWithProject({ ...task, episodeId: line.episodeId });
  const models = await resolveTaskModels(task, project);

  // Character's voice clip (a MediaObject id) drives the provider's voice — this
  // is what keeps one character on one voice across the episode (火豹 #85「同一
  // 個人上下鏡頭音色變了」). Null until a voice is assigned; the provider then
  // uses its default, same as before.
  const voiceId = line.characterId
    ? (await prisma.character.findUnique({ where: { id: line.characterId }, select: { voiceId: true } }))?.voiceId ?? undefined
    : undefined;

  const media = await generateTts(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: line.episodeId },
    {
      modelKey: models.tts,
      text: line.content,
      voiceId,
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
    include: { voiceLines: { orderBy: { lineIndex: "asc" } } },
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
        continue;
      }

      const linesWithAudio = shot.voiceLines.filter((l) => l.audioMediaId);
      let audioPath: string | undefined;
      if (linesWithAudio.length > 0) {
        const partPaths: string[] = [];
        for (let k = 0; k < linesWithAudio.length; k++) {
          const media = await prisma.mediaObject.findUniqueOrThrow({ where: { id: linesWithAudio[k].audioMediaId! } });
          const p = join(dir, `aud-${i}-${k}.m4a`);
          await writeFile(p, await storage.getObjectBuffer(media.storageKey));
          partPaths.push(p);
        }
        if (partPaths.length === 1) {
          audioPath = partPaths[0];
        } else {
          audioPath = join(dir, `aud-${i}.m4a`);
          await concatAudio(partPaths, audioPath);
        }
      }
      const subtitle = linesWithAudio.map((l) => l.content).join(" ") || undefined;

      const outPath = join(dir, `composed-${i}.mp4`);
      await composeShot({ videoPath: clipPath, audioPath, subtitle }, outPath);
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
