// AI episode planning for a project.
//   POST  → set planConfig + submit EPISODE_SPLIT (writes planResult, no episodes)
//   PATCH → pure planResult edits (rename/delete/merge/split/move) — no AI call
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { submitTask } from "@/lib/task/submit";
import { TASK_TYPE } from "@/lib/task/types";
import {
  PlanConfig,
  deleteEpisode,
  mergeIntoPrev,
  moveBoundary,
  planResultFromJson,
  renameEpisode,
  splitEpisode,
  summarizeRisk,
} from "@/lib/planning/plan";

async function getOwned(userId: string, id: string) {
  const project = await prisma.project.findFirst({ where: { id, userId } });
  if (!project) throw new ApiError("NOT_FOUND", 404);
  return project;
}

export const POST = withAuth(
  async ({ userId, params, req }) => {
    const project = await getOwned(userId, params.id);
    if (!project.sourceText.trim()) throw new ApiError("NO_SOURCE", 400, "先貼上小說原文");
    const cfg = PlanConfig.safeParse(await req.json());
    if (!cfg.success) throw new ApiError("BAD_CONFIG", 400, cfg.error.issues[0]?.message ?? "invalid config");

    await prisma.project.update({
      where: { id: project.id },
      data: { planConfig: cfg.data as object, planStatus: "planning", planResult: {} as object },
    });
    const { taskId } = await submitTask({
      userId,
      type: TASK_TYPE.EPISODE_SPLIT,
      targetType: "project",
      targetId: project.id,
      projectId: project.id,
      payload: { at: Date.now() },
    });
    return ok({ taskId });
  },
  { auditAction: "project.plan" },
);

type PlanEdit =
  | { op: "rename"; index: number; title: string }
  | { op: "delete"; index: number }
  | { op: "merge"; index: number }
  | { op: "split"; index: number; atEndAnchor: string; nextStartAnchor: string }
  | { op: "move"; index: number; newEndAnchor: string; newNextStartAnchor: string };

export const PATCH = withAuth(
  async ({ userId, params, req }) => {
    const project = await getOwned(userId, params.id);
    if (project.planStatus !== "planned") throw new ApiError("NOT_PLANNED", 400, "尚未規劃");
    const edit = (await req.json()) as PlanEdit;
    let episodes = planResultFromJson(project.planResult).episodes;

    switch (edit.op) {
      case "rename":
        episodes = renameEpisode(episodes, edit.index, edit.title);
        break;
      case "delete":
        episodes = deleteEpisode(episodes, edit.index);
        break;
      case "merge":
        episodes = mergeIntoPrev(episodes, edit.index);
        break;
      case "split":
        episodes = splitEpisode(episodes, edit.index, edit.atEndAnchor, edit.nextStartAnchor);
        break;
      case "move":
        episodes = moveBoundary(episodes, edit.index, edit.newEndAnchor, edit.newNextStartAnchor);
        break;
      default:
        throw new ApiError("BAD_OP", 400, "unknown edit op");
    }

    await prisma.project.update({ where: { id: project.id }, data: { planResult: { episodes } as object } });
    return ok({ episodes, risk: summarizeRisk(episodes) });
  },
  { auditAction: "project.plan-edit" },
);
