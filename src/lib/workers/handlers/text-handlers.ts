// Text-queue pipeline handlers: script rewrite, asset extraction, scene build,
// storyboard 4-phase run, voice analysis.
import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";
import { callModel } from "@/lib/ai/call-model";
import { buildPrompt } from "@/lib/prompts/build-prompt";
import { submitTask } from "@/lib/task/submit";
import { TASK_TYPE, TaskError } from "@/lib/task/types";
import type { TaskHandler } from "@/lib/workers/lifecycle";
import { getModelDefaults, loadEpisodeWithProject, sliceByAnchors, textCallJson } from "@/lib/workers/handlers/shared";

export const rewriteScriptHandler: TaskHandler = async ({ task, reportProgress }) => {
  const { episode, project } = await loadEpisodeWithProject(task);
  if (!episode.rawText) throw new TaskError("NO_SOURCE", "episode has no rawText", false);
  const models = getModelDefaults(project);

  reportProgress(10);
  const { text, version } = buildPrompt("rewrite_script", {
    novel_text: episode.rawText.slice(0, 30_000),
    style_note: project.stylePackId,
  });
  const result = await callModel(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id, promptId: "rewrite_script", promptVersion: version },
    { modelKey: models.text as `${string}::${string}`, messages: [{ role: "user", content: text }] },
  );
  if (!result.text.trim()) throw new TaskError("LLM_OUTPUT_INVALID", "empty script", true);

  reportProgress(90);
  await prisma.episode.update({ where: { id: episode.id }, data: { scriptText: result.text.trim() } });
  return { chars: result.text.length };
};

export const extractAssetsHandler: TaskHandler = async ({ task, reportProgress }) => {
  const { episode, project } = await loadEpisodeWithProject(task);
  const source = episode.scriptText || episode.rawText;
  if (!source) throw new TaskError("NO_SOURCE", "episode has no script/raw text", false);
  const models = getModelDefaults(project);

  reportProgress(10);
  const out = await textCallJson(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id },
    models.text,
    "extract_assets",
    { script_text: source.slice(0, 30_000) },
  );

  reportProgress(60);
  let created = 0;
  for (const c of out.characters) {
    const existing = await prisma.character.findFirst({ where: { projectId: project.id, name: c.name } });
    if (existing) {
      await prisma.character.update({
        where: { id: existing.id },
        data: { profile: c.appearance, appearancePrompt: `${c.appearance} ${c.wardrobe}`.trim(), aliases: c.aliases },
      });
    } else {
      await prisma.character.create({
        data: {
          id: newId(),
          userId: task.userId,
          projectId: project.id,
          name: c.name,
          aliases: c.aliases,
          profile: c.appearance,
          appearancePrompt: `${c.appearance} ${c.wardrobe}`.trim(),
        },
      });
      created++;
    }
  }
  for (const l of out.locations) {
    const name = `${l.name}·${l.timeOfDay}`; // location + time-of-day is the identity (extractor rule)
    const existing = await prisma.location.findFirst({ where: { projectId: project.id, name } });
    if (!existing) {
      await prisma.location.create({
        data: { id: newId(), userId: task.userId, projectId: project.id, name, summary: l.description, prompt: l.description },
      });
      created++;
    }
  }
  reportProgress(95);
  return { characters: out.characters.length, locations: out.locations.length, created };
};

export const buildScenesHandler: TaskHandler = async ({ task, reportProgress }) => {
  const { episode, project } = await loadEpisodeWithProject(task);
  const source = episode.scriptText || episode.rawText;
  if (!source) throw new TaskError("NO_SOURCE", "episode has no script/raw text", false);
  const models = getModelDefaults(project);

  reportProgress(10);
  const out = await textCallJson(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id },
    models.text,
    "build_scenes",
    { script_text: source.slice(0, 30_000) },
  );

  reportProgress(60);
  const slices = sliceByAnchors(source, out.scenes);
  await prisma.scene.deleteMany({ where: { episodeId: episode.id } }); // rebuild is idempotent
  for (let i = 0; i < slices.length; i++) {
    const meta = out.scenes[i];
    await prisma.scene.create({
      data: {
        id: newId(),
        userId: task.userId,
        episodeId: episode.id,
        sceneIndex: i + 1,
        summary: meta?.summary ?? "",
        content: slices[i].content,
        anchorStart: slices[i].anchorStart,
        anchorEnd: slices[i].anchorEnd,
      },
    });
  }
  reportProgress(95);
  return { scenes: slices.length };
};

export const storyboardRunHandler: TaskHandler = async ({ task, reportProgress }) => {
  const { episode, project } = await loadEpisodeWithProject(task);
  const models = getModelDefaults(project);
  const scenes = await prisma.scene.findMany({ where: { episodeId: episode.id }, orderBy: { sceneIndex: "asc" } });
  if (scenes.length === 0) throw new TaskError("NO_SCENES", "run BUILD_SCENES first", false);

  const ctx = { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id };
  await prisma.shot.deleteMany({ where: { episodeId: episode.id } }); // rebuild is idempotent

  let globalIndex = 0;
  for (let s = 0; s < scenes.length; s++) {
    const scene = scenes[s];
    const base = (s / scenes.length) * 100;
    const span = 100 / scenes.length;

    // Phase 1: plan
    const plan = await textCallJson(ctx, models.text, "storyboard_plan", { scene_text: scene.content.slice(0, 12_000) });
    reportProgress(base + span * 0.4);

    const shotListJson = JSON.stringify(plan.shots);
    // Phase 2+3 in parallel: photography + acting
    const [photo, acting] = await Promise.all([
      textCallJson(ctx, models.text, "storyboard_photography", { shot_list_json: shotListJson }),
      textCallJson(ctx, models.text, "storyboard_acting", { shot_list_json: shotListJson }),
    ]);
    reportProgress(base + span * 0.7);

    // Phase 4: detail
    const detail = await textCallJson(ctx, models.text, "storyboard_detail", {
      shot_list_json: shotListJson,
      scene_type: scene.summary.slice(0, 40) || "daily",
    });
    reportProgress(base + span * 0.9);

    const photoByIdx = new Map(photo.shots.map((x) => [x.index, x]));
    const actingByIdx = new Map(acting.shots.map((x) => [x.index, x]));
    const detailByIdx = new Map(detail.shots.map((x) => [x.index, x]));

    for (const shot of plan.shots) {
      globalIndex++;
      await prisma.shot.create({
        data: {
          id: newId(),
          userId: task.userId,
          episodeId: episode.id,
          sceneId: scene.id,
          shotIndex: globalIndex,
          durationMs: 3000,
          storyboardJson: {
            plan: shot,
            photography: photoByIdx.get(shot.index) ?? null,
            acting: actingByIdx.get(shot.index) ?? null,
            detail: detailByIdx.get(shot.index) ?? null,
          } as object,
        },
      });
    }
  }
  return { shots: globalIndex, scenes: scenes.length };
};

export const voiceAnalyzeHandler: TaskHandler = async ({ task, reportProgress }) => {
  const { episode, project } = await loadEpisodeWithProject(task);
  const models = getModelDefaults(project);
  const scenes = await prisma.scene.findMany({ where: { episodeId: episode.id }, orderBy: { sceneIndex: "asc" } });
  const shots = await prisma.shot.findMany({ where: { episodeId: episode.id }, orderBy: { shotIndex: "asc" } });
  if (shots.length === 0) throw new TaskError("NO_SHOTS", "run STORYBOARD_RUN first", false);

  const shotList = shots.map((sh) => ({ index: sh.shotIndex, ...(sh.storyboardJson as { plan?: object }).plan }));
  const sceneText = scenes.map((s) => s.content).join("\n").slice(0, 20_000);

  reportProgress(10);
  const out = await textCallJson(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id },
    models.text,
    "voice_analyze",
    { scene_text: sceneText, shot_list_json: JSON.stringify(shotList) },
  );

  reportProgress(60);
  const shotByIndex = new Map(shots.map((sh) => [sh.shotIndex, sh]));
  const characters = await prisma.character.findMany({ where: { projectId: project.id } });
  await prisma.voiceLine.deleteMany({ where: { episodeId: episode.id } });

  let created = 0;
  for (const line of out.lines) {
    const matched = shotByIndex.get(line.matchedShotIndex);
    const character = characters.find((c) => c.name === line.speaker);
    await prisma.voiceLine.create({
      data: {
        id: newId(),
        userId: task.userId,
        episodeId: episode.id,
        lineIndex: ++created,
        speaker: line.speaker,
        content: line.text,
        characterId: character?.id,
        emotion: line.emotion,
        emotionStrength: Math.min(0.5, line.emotionStrength),
        matchedShotId: matched?.id, // hallucinated shot refs become null, not errors
      },
    });
  }

  // fan out TTS tasks
  reportProgress(85);
  const lines = await prisma.voiceLine.findMany({ where: { episodeId: episode.id } });
  for (const line of lines) {
    await submitTask({
      userId: task.userId,
      type: TASK_TYPE.TTS_LINE,
      targetType: "voiceLine",
      targetId: line.id,
      projectId: project.id,
      episodeId: episode.id,
    });
  }
  return { lines: created };
};
