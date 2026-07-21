// EPISODE_SPLIT handler — operates on a PROJECT (task.targetId = projectId).
// Reads sourceText + planConfig, asks the model to split + self-flag risk, then
// writes Project.planResult. Does NOT create Episode rows — that happens on
// explicit confirm (docs/plans/2026-07-19-episode-planning-design.md).
import { prisma } from "@/lib/db";
import { TaskError } from "@/lib/task/types";
import type { TaskHandler } from "@/lib/workers/lifecycle";
import { resolveTaskModels, sliceByAnchors, textCallJson, promptOverridesFromTask } from "@/lib/workers/handlers/shared";
import { applyHeuristicRisk, planConfigFromJson, targetHint } from "@/lib/planning/plan";

const SOURCE_CAP = 30_000; // single-call cap; longer novels are a v2 two-stage flow

export const episodeSplitHandler: TaskHandler = async ({ task, reportProgress }) => {
  const project = await prisma.project.findFirst({ where: { id: task.targetId, userId: task.userId } });
  if (!project) throw new TaskError("NOT_FOUND", `project ${task.targetId} not found`, false);
  if (!project.sourceText.trim()) throw new TaskError("NO_SOURCE", "project has no sourceText", false);

  const cfg = planConfigFromJson(project.planConfig);
  if (!cfg) throw new TaskError("BAD_CONFIG", "invalid planConfig", false);
  const models = await resolveTaskModels(task, project);

  reportProgress(10);
  const out = await textCallJson(
    { userId: task.userId, taskId: task.id, projectId: project.id, oneOff: promptOverridesFromTask(task) },
    models.text,
    "episode_split",
    {
      source_text: project.sourceText.slice(0, SOURCE_CAP),
      target_hint: targetHint(cfg),
      hook_strength: cfg.hookStrength,
      theme: project.theme.trim() || "（未設定）",
    },
  );

  reportProgress(70);
  // Anchor-slice against the source to measure real per-episode length, then let
  // the heuristic backstop raise attention the model may have missed.
  const slices = sliceByAnchors(project.sourceText, out.episodes);
  const lengths = slices.map((s) => s.content.length);
  const episodes = applyHeuristicRisk(out.episodes, lengths, cfg);

  await prisma.project.update({
    where: { id: project.id },
    data: { planResult: { episodes } as object, planStatus: "planned" },
  });
  reportProgress(95);
  return { episodes: episodes.length };
};
