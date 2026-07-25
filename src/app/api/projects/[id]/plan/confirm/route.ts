// Commit the reviewed plan → create Episode rows, one per planned episode,
// rawText sliced from sourceText by anchors. This is the ✋ review gate exit.
import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { planResultFromJson } from "@/lib/planning/plan";
import { sliceByAnchors } from "@/lib/workers/handlers/shared";

export const POST = withAuth(
  async ({ userId, params, req }) => {
    const project = await prisma.project.findFirst({ where: { id: params.id, userId } });
    if (!project) throw new ApiError("NOT_FOUND", 404);
    if (project.planStatus !== "planned") throw new ApiError("NOT_PLANNED", 400, "尚未規劃");

    const { episodes } = planResultFromJson(project.planResult);
    if (episodes.length === 0) throw new ApiError("EMPTY_PLAN", 400, "規劃為空");

    const existing = await prisma.episode.count({ where: { projectId: project.id } });
    const body = (await req.json().catch(() => ({}))) as { force?: boolean };
    // Re-confirming when episodes already exist would duplicate the series — the
    // client must acknowledge (force) after warning the user.
    if (existing > 0 && !body.force) {
      throw new ApiError("EPISODES_EXIST", 409, `本專案已有 ${existing} 集。確定要再生成請帶 force:true。`);
    }

    const slices = sliceByAnchors(project.sourceText, episodes);
    const created = await prisma.$transaction(async (tx) => {
      const rows = [];
      for (let i = 0; i < episodes.length; i++) {
        const ep = episodes[i];
        rows.push({
          id: newId(),
          userId,
          projectId: project.id,
          episodeNumber: existing + i + 1,
          rawText: slices[i]?.content ?? "",
          status: "draft",
          autorun: true,
          autorunConfig: { mode: "assisted" },
        });
      }
      await tx.episode.createMany({ data: rows });
      await tx.project.update({ where: { id: project.id }, data: { planStatus: "planned" } });
      return rows.length;
    });

    return ok({ created });
  },
  { auditAction: "project.plan-confirm" },
);
