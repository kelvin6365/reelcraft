import { prisma } from "@/lib/db";
import { callModel } from "@/lib/ai/call-model";
import { resolvePrompt } from "@/lib/prompts/resolve-prompt";
import { safeParseJson } from "@/lib/prompts/parse";
import { outputSchemas, type OutputSchemaId } from "@/lib/prompts/schemas";
import { TaskError } from "@/lib/task/types";
import { resolveModelDefaults, type ResolvedModelDefaults } from "@/lib/model-defaults/resolve";
import type { Episode, Project, Task } from "@prisma/client";
import type { z } from "zod";

// Re-export so handlers keep importing the shape from here.
export type { ModelDefaults } from "@/lib/model-defaults/resolve";

// Resolve the effective models for a task through the three-layer resolver and
// log the outcome once (which layer won each slot). Replaces the old sync
// getModelDefaults + its fake::* fallbacks — resolution now bottoms out at real
// system defaults, never fake (CLAUDE.md #3).
export async function resolveTaskModels(
  task: Pick<Task, "id" | "userId">,
  project?: Pick<Project, "modelDefaults"> | null,
): Promise<ResolvedModelDefaults> {
  const models = await resolveModelDefaults(task.userId, project);
  const s = models.source;
  console.log(
    `[model-resolve] task=${task.id} text=${models.text}(${s.text}) image=${models.image}(${s.image}) video=${models.video}(${s.video}) tts=${models.tts}(${s.tts})`,
  );
  return models;
}

export async function loadEpisodeWithProject(task: Task): Promise<{ episode: Episode; project: Project }> {
  if (!task.episodeId) throw new TaskError("BAD_PAYLOAD", "task has no episodeId", false);
  const episode = await prisma.episode.findFirst({
    where: { id: task.episodeId, userId: task.userId },
    include: { project: true },
  });
  if (!episode) throw new TaskError("NOT_FOUND", `episode ${task.episodeId} not found`, false);
  const { project, ...rest } = episode;
  return { episode: rest as Episode, project };
}

// resolvePrompt → callModel → parse → zod validate, with corrective retries on
// bad JSON/schema (each retry appends the error so the model can fix itself).
// 3 attempts, not 2 — real QA on a 6-character stress-test script showed
// gemini-2.5-flash-lite occasionally drops an entire top-level key (e.g.
// "locations") even on the corrective 2nd attempt, so a 3rd chance measurably
// improves the odds without materially raising cost (cheap "lite" tier).
export async function textCallJson<Id extends OutputSchemaId>(
  ctx: { userId: string; taskId: string; projectId?: string; episodeId?: string; oneOff?: Record<string, string> },
  modelKey: string,
  promptId: Id,
  variables: Record<string, string>,
): Promise<z.infer<(typeof outputSchemas)[Id]>> {
  const schema = outputSchemas[promptId];
  const p = await resolvePrompt(promptId, variables, {
    userId: ctx.userId,
    projectId: ctx.projectId,
    oneOffText: ctx.oneOff?.[promptId],
  });

  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const content = attempt === 1 ? p.text : `${p.text}\n\n【上次輸出無效，錯誤：${lastError.slice(0, 300)}。請只輸出合法 JSON。】`;
    const result = await callModel(
      { ...ctx, promptId, promptVersion: p.version, promptSource: p.source, renderedPrompt: content },
      // maxTokens: without an explicit cap the provider's own default applies,
      // which can be too small for the heaviest schema (extract_assets on a
      // many-character script) and truncate mid-object into invalid JSON.
      // 8192 covers it comfortably at negligible cost.
      { modelKey: modelKey as `${string}::${string}`, messages: [{ role: "user", content }], jsonMode: true, maxTokens: 8192 },
    );
    try {
      const parsed = schema.safeParse(safeParseJson(result.text));
      if (parsed.success) return parsed.data as z.infer<(typeof outputSchemas)[Id]>;
      lastError = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    } catch (err) {
      lastError = String(err instanceof Error ? err.message : err);
    }
  }
  throw new TaskError("LLM_OUTPUT_INVALID", `${promptId}: ${lastError.slice(0, 500)}`, false);
}

// Reads the per-task promptOverrides map (Slice 1: always empty — nothing
// populates the payload yet; wiring lands in a later slice's rerun-prompt API).
export function promptOverridesFromTask(task: { payload: unknown }): Record<string, string> {
  return (task.payload as { promptOverrides?: Record<string, string> })?.promptOverrides ?? {};
}

// Anchor location with graceful fallback: if the LLM's anchors don't appear in
// the source, split proportionally instead of failing the whole pipeline.
export function sliceByAnchors(
  source: string,
  anchors: { startAnchor: string; endAnchor: string }[],
): { content: string; anchorStart: string; anchorEnd: string }[] {
  const found = anchors.map((a) => {
    const start = source.indexOf(a.startAnchor);
    const end = source.indexOf(a.endAnchor, Math.max(start, 0));
    return start >= 0 && end > start ? { start, end: end + a.endAnchor.length, a } : null;
  });

  if (found.every((f) => f !== null)) {
    return (found as NonNullable<(typeof found)[number]>[]).map((f) => ({
      content: source.slice(f.start, f.end),
      anchorStart: f.a.startAnchor,
      anchorEnd: f.a.endAnchor,
    }));
  }

  // fallback: proportional split
  const n = Math.max(1, anchors.length);
  const step = Math.ceil(source.length / n);
  return Array.from({ length: n }, (_, i) => ({
    content: source.slice(i * step, Math.min((i + 1) * step, source.length)),
    anchorStart: "",
    anchorEnd: "",
  })).filter((s) => s.content.length > 0);
}
