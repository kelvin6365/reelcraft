// Media-queue handlers: asset/shot images, shot videos, TTS lines, episode compose.
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";
import { generateImage, generateTts, generateVideo } from "@/lib/ai/generate-media";
import { getStorage } from "@/lib/storage";
import { createMediaFromBuffer } from "@/lib/media/service";
import { composeShot, concatAudio, concatShots, imageToVideoClip, probeDurationMs } from "@/lib/video/ffmpeg";
import { TaskError } from "@/lib/task/types";
import type { TaskHandler } from "@/lib/workers/lifecycle";
import { resolveTaskModels, loadEpisodeWithProject, textCallJson } from "@/lib/workers/handlers/shared";

interface StylePack {
  prefix?: string;
  // Asset-reference style: identity-level look only (photoreal vs anime). Scene
  // tokens (DOF, color grade, volumetric light) must NOT bake into references —
  // they'd propagate to every shot via img2img. Falls back to prefix if absent.
  assetPrefix?: string;
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
    const models = await resolveTaskModels(task, project);
    const style = await loadStyle(project.stylePackId);

    const basePrompt = "appearancePrompt" in row && row.appearancePrompt ? row.appearancePrompt : ((row as { prompt?: string }).prompt ?? "");

    // Face close-up mode (payload.face): one 近臉特寫 derived from the locked
    // turnaround via img2img — the strongest identity ref for shot/video gen.
    // Every character ends up with ≥2 reference images: turnaround + face.
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
          aspectRatio: "1:1", // square maximises face pixels in the reference
          keyPrefix: `projects/${project.id}/characters/${row.id}`,
          referenceMediaIds: [row.lockedImageMediaId],
        },
      );
      await prisma.character.update({ where: { id: row.id }, data: { faceImageMediaId: media.id } });
      return { face: media.id };
    }
    // Reference-optimized framing (v3 標準, docs/plans/2026-07-20 + 教材三段式):
    // a character asset is REUSED as an img2img reference across every shot, so a
    // single front view isn't enough — multi-view TURNAROUND of the SAME identity,
    // arranged as a 2×2 grid to fit the 9:16 portrait standard. Clean white
    // background + flat lighting so no scene look is baked into the reference;
    // hands fully visible (cropped/deformed hands would propagate to every shot).
    const refFraming =
      kind === "character"
        ? "character reference sheet in two stacked sections: TOP HALF is one large ultra-detailed head-and-shoulders face close-up of the character; BOTTOM HALF is a row of three full-body standing views of the SAME character — front view, side profile, and back view — evenly spaced, not overlapping. Identical face, hairstyle, outfit and body in every view. Strict visual alignment: identical height, facial-feature placement and clothing folds must match perfectly across all views. Full body visible in each bottom view, both hands fully visible and relaxed naturally at the sides. Clean pure white background, flat even studio lighting, sharp focus everywhere, no cast shadows, no text, no labels, no captions anywhere, clean composition, rich detail, high quality, 4K resolution"
        : "establishing reference view, even neutral lighting, clear wide framing, no text, no labels, clean composition, rich detail, high quality";
    const assetRatio = "9:16"; // 人物比例默認 9:16（2×2 turnaround 格局）；場景同視頻比例一致
    // 三段式次序：畫面風格 → 人物本體 → 畫面要求（風格行先錨定整體畫風）。
    // 資產用 assetPrefix（身份層風格）而非場景 prefix — 見 StylePack 註釋。
    const fullPrompt = [style.assetPrefix ?? style.prefix ?? "", basePrompt, refFraming].filter(Boolean).join(". ").trim();

    // Self-referencing regeneration (M2a): if the asset already has a locked image
    // and the caller asks to keep identity, feed that image as a reference so the
    // regenerated candidates keep the same face/identity while pose/outfit can
    // change (waoowaoo/Toonflow's canonical-image trick).
    const keepIdentity = (task.payload as { keepIdentity?: boolean }).keepIdentity === true;
    const identityRef = keepIdentity && row.lockedImageMediaId ? [row.lockedImageMediaId] : undefined;

    const mediaIds: string[] = [];
    for (let i = 0; i < CANDIDATE_COUNT; i++) {
      const media = await generateImage(
        { userId: task.userId, taskId: task.id, projectId: project.id },
        {
          modelKey: models.image,
          // no "(variant N)" suffix: text-happy models can render it onto the
          // sheet and captions poison img2img refs; sampling already varies runs
          prompt: fullPrompt,
          negativePrompt: style.negativePrompt,
          aspectRatio: assetRatio,
          keyPrefix: `projects/${project.id}/${kind}s/${row.id}`,
          referenceMediaIds: identityRef,
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

// 場景空間契約 → prompt 注入文本（scene.blocking，storyboard_plan 一次過鎖定）。
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
  if (!shot) throw new TaskError("NOT_FOUND", `shot ${task.targetId} not found`, false);
  const scene = await prisma.scene.findUnique({ where: { id: shot.sceneId }, select: { blocking: true } });
  const { episode, project } = await loadEpisodeWithProject({ ...task, episodeId: shot.episodeId });
  const models = await resolveTaskModels(task, project);
  const style = await loadStyle(project.stylePackId);

  // Character consistency: collect the LOCKED reference images for the assets that
  // actually appear in THIS shot, ordered. The prompt binds each by a 图片N legend
  // so the model conditions identity on the injected pixels, not on the name.
  const lockedCharacters = await prisma.character.findMany({ where: { projectId: project.id, locked: true } });
  const lockedLocations = await prisma.location.findMany({ where: { projectId: project.id, locked: true } });

  const plan = (shot.storyboardJson as { plan?: { characters?: string[] } }).plan;
  const shotCharNames = plan?.characters ?? [];
  const nameMatches = (assetName: string) =>
    shotCharNames.some((n) => assetName.includes(n) || n.includes(assetName));
  // characters named in this shot (fall back to all locked chars if the plan named none)
  const shotCharacters = shotCharNames.length
    ? lockedCharacters.filter((c) => nameMatches(c.name))
    : lockedCharacters;
  // location: v1 uses the first locked location (per-scene binding is M2)
  const shotLocation = lockedLocations[0];

  // Per character: turnaround + 近臉特寫 (when generated) — the face close-up is
  // the strongest identity anchor for the shot image and downstream video.
  const refAssets = [
    ...shotCharacters
      .filter((c) => c.lockedImageMediaId)
      .flatMap((c) => [
        { mediaId: c.lockedImageMediaId!, label: `${c.name}（角色全身多視角）`, prompt: c.appearancePrompt },
        ...(c.faceImageMediaId ? [{ mediaId: c.faceImageMediaId, label: `${c.name}（面部特寫）`, prompt: "面部身份參照" }] : []),
      ]),
    ...(shotLocation?.lockedImageMediaId ? [{ mediaId: shotLocation.lockedImageMediaId, label: `${shotLocation.name}（場景）`, prompt: shotLocation.prompt }] : []),
  ];
  const referenceMediaIds = refAssets.map((a) => a.mediaId);
  // 图片1=林知夏（角色）；图片2=咖啡店·夜（場景）
  const referenceLegend = refAssets.map((a, i) => `图片${i + 1}=${a.label}`).join("；") || "（無參考圖）";
  const lockedAssets = refAssets.map((a, i) => `图片${i + 1}（${a.label}）: ${a.prompt}`).join("\n") || "（無鎖定資產）";

  reportProgress(10);
  const out = await textCallJson(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id },
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
      negativePrompt: out.negativePrompt || style.negativePrompt,
      aspectRatio: project.videoRatio,
      keyPrefix: `projects/${project.id}/shots/${shot.id}`,
      referenceMediaIds,
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
  const models = await resolveTaskModels(task, project);

  const sb = shot.storyboardJson as { plan?: { subject?: string }; detail?: { video_prompt?: string } };
  const durationSec = Math.max(2, Math.round(shot.durationMs / 1000) || 3);
  // Prefer the motion-ready video_prompt authored by the storyboard detail stage
  // (time + action + camera), over a user override, over the still-image subject.
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

  await prisma.shot.update({ where: { id: shot.id }, data: { videoMediaId: media.id } });
  return { mediaId: media.id };
};

export const ttsLineHandler: TaskHandler = async ({ task }) => {
  const line = await prisma.voiceLine.findFirst({ where: { id: task.targetId, userId: task.userId } });
  if (!line) throw new TaskError("NOT_FOUND", `voiceLine ${task.targetId} not found`, false);
  const { project } = await loadEpisodeWithProject({ ...task, episodeId: line.episodeId });
  const models = await resolveTaskModels(task, project);

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
    include: { voiceLines: { orderBy: { lineIndex: "asc" } } }, // deterministic order; a shot may own several lines
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

      // A shot can own multiple dialogue lines (many-to-one matchedShotIndex).
      // Concatenate all their audio into one track and join their text as the
      // subtitle — dropping the extras would waste the TTS spend and lose dialogue.
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
