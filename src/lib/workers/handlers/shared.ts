import { prisma } from "@/lib/db";
import { callModel } from "@/lib/ai/call-model";
import { buildPrompt } from "@/lib/prompts/build-prompt";
import { safeParseJson } from "@/lib/prompts/parse";
import { outputSchemas, type OutputSchemaId } from "@/lib/prompts/schemas";
import { TaskError } from "@/lib/task/types";
import type { Episode, Project, Task } from "@prisma/client";
import type { z } from "zod";

export interface ModelDefaults {
  text: string;
  image: string;
  video: string;
  tts: string;
}

// Missing entries fall back to the fake provider so dev/offline always runs.
// No silent provider guessing happens here: the key itself still names its provider.
export function getModelDefaults(project: Project): ModelDefaults {
  const d = (project.modelDefaults ?? {}) as Partial<ModelDefaults>;
  return {
    text: d.text ?? "fake::pipeline",
    image: d.image ?? "fake::image",
    video: d.video ?? "fake::video",
    tts: d.tts ?? "fake::tts",
  };
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

// buildPrompt → callModel → parse → zod validate, with one corrective retry on
// bad JSON/schema (the retry appends the error so the model can fix itself).
export async function textCallJson<Id extends OutputSchemaId>(
  ctx: { userId: string; taskId: string; projectId?: string; episodeId?: string },
  modelKey: string,
  promptId: Id,
  variables: Record<string, string>,
): Promise<z.infer<(typeof outputSchemas)[Id]>> {
  const schema = outputSchemas[promptId];
  const { text, version } = buildPrompt(promptId, variables);

  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const content = attempt === 1 ? text : `${text}\n\n【上次輸出無效，錯誤：${lastError.slice(0, 300)}。請只輸出合法 JSON。】`;
    const result = await callModel(
      { ...ctx, promptId, promptVersion: version },
      { modelKey: modelKey as `${string}::${string}`, messages: [{ role: "user", content }] },
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
