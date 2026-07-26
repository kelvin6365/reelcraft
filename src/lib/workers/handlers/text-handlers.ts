import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";
import { callModel } from "@/lib/ai/call-model";
import { resolvePrompt } from "@/lib/prompts/resolve-prompt";
import { submitTask } from "@/lib/task/submit";
import { TASK_TYPE, TaskError } from "@/lib/task/types";
import { parseSrt } from "@/lib/srt";
import { matchReusableAudio } from "@/lib/voice/reuse-audio";
import { planResume } from "@/lib/storyboard/resume";
import type { TaskHandler } from "@/lib/workers/lifecycle";
import {
  resolveTaskModels,
  loadEpisodeWithProject,
  sliceByAnchors,
  textCallJson,
  promptOverridesFromTask,
} from "@/lib/workers/handlers/shared";
import type { Character } from "@prisma/client";

interface CharacterBioJson { age?: string; occupation?: string; personality?: string; painPoint?: string; backstory?: string }
function formatCharacterBios(characters: Character[]): string {
  return characters
    .map((c) => {
      const b = (c.bio ?? {}) as CharacterBioJson;
      const parts = [
        c.profile && `外貌：${c.profile}`,
        b.age && `年齡：${b.age}`,
        b.occupation && `職業：${b.occupation}`,
        b.personality && `性格：${b.personality}`,
        b.painPoint && `痛點：${b.painPoint}`,
        b.backstory && `前史：${b.backstory}`,
      ].filter(Boolean);
      return parts.length ? `- ${c.name}：${parts.join("；")}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

export const rewriteScriptHandler: TaskHandler = async ({ task, reportProgress }) => {
  const { episode, project } = await loadEpisodeWithProject(task);
  if (!episode.rawText) throw new TaskError("NO_SOURCE", "episode has no rawText", false);
  const models = await resolveTaskModels(task, project);

  reportProgress(10);
  const bios = formatCharacterBios(await prisma.character.findMany({ where: { projectId: project.id } }));
  const variables = {
    novel_text: episode.rawText.slice(0, 30_000),
    style_note: project.stylePackId,
    theme: project.theme.trim() || "（未設定，按原文精神改寫）",
    character_bios: bios || "（暫無，首集由你根據原文塑造）",
  };
  const oneOff = promptOverridesFromTask(task);
  const p = await resolvePrompt("rewrite_script", variables, {
    userId: task.userId,
    projectId: project.id,
    oneOffText: oneOff.rewrite_script,
  });
  const result = await callModel(
    {
      userId: task.userId,
      taskId: task.id,
      projectId: project.id,
      episodeId: episode.id,
      promptId: "rewrite_script",
      promptVersion: p.version,
      promptSource: p.source,
      renderedPrompt: p.text,
    },
    { modelKey: models.text as `${string}::${string}`, messages: [{ role: "user", content: p.text }] },
  );
  if (!result.text.trim()) throw new TaskError("LLM_OUTPUT_INVALID", "empty script", true);

  let script = result.text.trim();
  const firstScene = script.indexOf("【第");
  if (firstScene > 0) script = script.slice(firstScene);

  reportProgress(90);
  await prisma.episode.update({ where: { id: episode.id }, data: { scriptText: script, scriptReview: {} } });
  return { chars: result.text.length };
};

export const scriptReviewHandler: TaskHandler = async ({ task, reportProgress }) => {
  const { episode, project } = await loadEpisodeWithProject(task);
  if (!episode.scriptText) throw new TaskError("NO_SOURCE", "episode has no scriptText", false);
  const models = await resolveTaskModels(task, project);

  reportProgress(10);
  const out = await textCallJson(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id, oneOff: promptOverridesFromTask(task) },
    models.text,
    "script_review",
    { script_text: episode.scriptText.slice(0, 30_000) },
  );

  reportProgress(90);
  await prisma.episode.update({ where: { id: episode.id }, data: { scriptReview: out as object } });
  return { scenes: out.scenes.length, overall: out.overall.level };
};

export const extractAssetsHandler: TaskHandler = async ({ task, reportProgress }) => {
  const { episode, project } = await loadEpisodeWithProject(task);
  const source = episode.scriptText || episode.rawText;
  if (!source) throw new TaskError("NO_SOURCE", "episode has no script/raw text", false);
  const models = await resolveTaskModels(task, project);

  reportProgress(10);
  const out = await textCallJson(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id, oneOff: promptOverridesFromTask(task) },
    models.text,
    "extract_assets",
    { script_text: source.slice(0, 30_000) },
  );

  reportProgress(60);
  let created = 0;
  for (const c of out.characters) {
    const bio = { age: c.age, occupation: c.occupation, personality: c.personality, painPoint: c.painPoint, backstory: c.backstory, note: c.note };
    const existing = await prisma.character.findFirst({ where: { projectId: project.id, name: c.name } });
    if (existing) {
      await prisma.character.update({
        where: { id: existing.id },
        data: { profile: c.appearance, appearancePrompt: `${c.appearance} ${c.wardrobe}`.trim(), aliases: c.aliases, bio },
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
          bio,
        },
      });
      created++;
    }
  }
  for (const l of out.locations) {
    const name = `${l.name}·${l.timeOfDay}`;
    const existing = await prisma.location.findFirst({ where: { projectId: project.id, name } });
    if (!existing) {
      await prisma.location.create({
        data: {
          id: newId(),
          userId: task.userId,
          projectId: project.id,
          name,
          summary: l.description,
          prompt: l.description,
          angles: l.angles.map((a) => ({ ...a, mediaId: null })),
        },
      });
      created++;
    }
    // existing: skip — 唔覆寫用戶已改嘅 angles／已生成圖
  }
  reportProgress(95);
  return { characters: out.characters.length, locations: out.locations.length, created };
};

export const buildScenesHandler: TaskHandler = async ({ task, reportProgress }) => {
  const { episode, project } = await loadEpisodeWithProject(task);
  const source = episode.scriptText || episode.rawText;
  if (!source) throw new TaskError("NO_SOURCE", "episode has no script/raw text", false);
  const models = await resolveTaskModels(task, project);

  reportProgress(10);
  const out = await textCallJson(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id, oneOff: promptOverridesFromTask(task) },
    models.text,
    "build_scenes",
    { script_text: source.slice(0, 30_000) },
  );

  reportProgress(60);
  const slices = sliceByAnchors(source, out.scenes);
  await prisma.scene.deleteMany({ where: { episodeId: episode.id } });
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

  const then = (task.payload as { then?: string }).then;
  if (then === TASK_TYPE.STORYBOARD_RUN) {
    await submitTask({
      userId: task.userId,
      type: TASK_TYPE.STORYBOARD_RUN,
      targetType: "episode",
      targetId: episode.id,
      projectId: project.id,
      episodeId: episode.id,
      payload: { chainedFrom: task.id },
    });
  }
  return { scenes: slices.length, chained: then === TASK_TYPE.STORYBOARD_RUN };
};

export const storyboardRunHandler: TaskHandler = async ({ task, reportProgress }) => {
  const { episode, project } = await loadEpisodeWithProject(task);
  const models = await resolveTaskModels(task, project);
  const scenes = await prisma.scene.findMany({ where: { episodeId: episode.id }, orderBy: { sceneIndex: "asc" } });
  if (scenes.length === 0) throw new TaskError("NO_SCENES", "run BUILD_SCENES first", false);

  const ctx = { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id, oneOff: promptOverridesFromTask(task) };

  const payload = (task.payload ?? {}) as { doneSceneIds?: string[] };
  const doneSceneIds = Array.isArray(payload.doneSceneIds) ? payload.doneSceneIds : [];
  const { toBuild, keepSceneIds, skipped } = planResume(scenes, doneSceneIds);
  await prisma.shot.deleteMany({ where: { episodeId: episode.id, sceneId: { notIn: keepSceneIds } } });
  if (skipped > 0) console.log(`[storyboard] task=${task.id} resuming — ${skipped}/${scenes.length} scenes already built`);

  let globalIndex = await prisma.shot.count({ where: { episodeId: episode.id } });
  for (let s = 0; s < toBuild.length; s++) {
    const scene = toBuild[s];
    const base = ((skipped + s) / scenes.length) * 100;
    const span = 100 / scenes.length;

    const plan = await textCallJson(ctx, models.text, "storyboard_plan", { scene_text: scene.content.slice(0, 12_000) });
    await prisma.scene.update({ where: { id: scene.id }, data: { blocking: plan.blocking as object } });
    reportProgress(base + span * 0.4);

    const shotListJson = JSON.stringify(plan.shots);
    const [photo, acting] = await Promise.all([
      textCallJson(ctx, models.text, "storyboard_photography", { shot_list_json: shotListJson }),
      textCallJson(ctx, models.text, "storyboard_acting", { shot_list_json: shotListJson }),
    ]);
    reportProgress(base + span * 0.7);

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

    doneSceneIds.push(scene.id);
    await prisma.task.update({ where: { id: task.id }, data: { payload: { ...payload, doneSceneIds } } });
  }
  return { shots: globalIndex, scenes: scenes.length, resumedFrom: skipped };
};

export const srtBuildHandler: TaskHandler = async ({ task, reportProgress }) => {
  const { episode } = await loadEpisodeWithProject(task);
  if (!episode.rawText) throw new TaskError("NO_SOURCE", "episode has no rawText", false);

  const cues = parseSrt(episode.rawText);
  reportProgress(20);

  await prisma.voiceLine.deleteMany({ where: { episodeId: episode.id } });
  await prisma.shot.deleteMany({ where: { episodeId: episode.id } });
  await prisma.scene.deleteMany({ where: { episodeId: episode.id } });

  const scene = await prisma.scene.create({
    data: {
      id: newId(),
      userId: task.userId,
      episodeId: episode.id,
      sceneIndex: 1,
      summary: "SRT",
      content: cues.map((c) => c.text).join("\n"),
    },
  });

  reportProgress(40);
  for (const cue of cues) {
    const shotId = newId();
    const durationMs = Math.min(15_000, Math.max(1000, cue.endMs - cue.startMs));
    await prisma.shot.create({
      data: {
        id: shotId,
        userId: task.userId,
        episodeId: episode.id,
        sceneId: scene.id,
        shotIndex: cue.index,
        durationMs,
        storyboardJson: { plan: { source_text: cue.text, subject: cue.text.slice(0, 50), index: cue.index } } as object,
      },
    });
    await prisma.voiceLine.create({
      data: {
        id: newId(),
        userId: task.userId,
        episodeId: episode.id,
        lineIndex: cue.index,
        speaker: "旁白",
        content: cue.text,
        emotionStrength: 0.3,
        matchedShotId: shotId,
      },
    });
  }
  reportProgress(95);
  return { cues: cues.length, shots: cues.length, voiceLines: cues.length };
};

export const voiceAnalyzeHandler: TaskHandler = async ({ task, reportProgress }) => {
  const { episode, project } = await loadEpisodeWithProject(task);
  const models = await resolveTaskModels(task, project);
  const scenes = await prisma.scene.findMany({ where: { episodeId: episode.id }, orderBy: { sceneIndex: "asc" } });
  const shots = await prisma.shot.findMany({ where: { episodeId: episode.id }, orderBy: { shotIndex: "asc" } });
  if (shots.length === 0) throw new TaskError("NO_SHOTS", "run STORYBOARD_RUN first", false);

  const shotList = shots.map((sh) => ({ index: sh.shotIndex, ...(sh.storyboardJson as { plan?: object }).plan }));
  const sceneText = scenes.map((s) => s.content).join("\n").slice(0, 20_000);

  reportProgress(10);
  const out = await textCallJson(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id, oneOff: promptOverridesFromTask(task) },
    models.text,
    "voice_analyze",
    { scene_text: sceneText, shot_list_json: JSON.stringify(shotList) },
  );

  reportProgress(60);
  const shotByIndex = new Map(shots.map((sh) => [sh.shotIndex, sh]));
  const characters = await prisma.character.findMany({ where: { projectId: project.id } });

  // Reuse must key on the same fields TTS actually consumes (text + speaker +
  // emotion + strength) and compare the strength as it is STORED (capped), so a
  // line whose only change is emotion is correctly re-synthesized.
  const capStrength = (s: number) => Math.min(0.5, s);
  const previous = await prisma.voiceLine.findMany({
    where: { episodeId: episode.id },
    orderBy: { lineIndex: "asc" },
    select: { speaker: true, content: true, emotion: true, emotionStrength: true, audioMediaId: true },
  });
  const inherited = matchReusableAudio(
    previous,
    out.lines.map((l) => ({
      speaker: l.speaker,
      content: l.text,
      emotion: l.emotion,
      emotionStrength: capStrength(l.emotionStrength),
    })),
  );
  await prisma.voiceLine.deleteMany({ where: { episodeId: episode.id } });

  let created = 0;
  for (const [i, line] of out.lines.entries()) {
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
        lineType: line.lineType,
        cue: line.cue,
        emotion: line.emotion,
        emotionStrength: capStrength(line.emotionStrength),
        matchedShotId: matched?.id,
        audioMediaId: inherited[i],
      },
    });
  }

  reportProgress(85);
  const lines = await prisma.voiceLine.findMany({ where: { episodeId: episode.id, audioMediaId: null } });
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
  return { lines: created, reusedAudio: created - lines.length };
};
