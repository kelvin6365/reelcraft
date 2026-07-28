// Regenerate a character's front-view candidate, or generate/regenerate one
// per-view (側面/背面) image or the face close-up. Once locked, the plain
// (main-image) regen path is blocked — 解鎖 first (parity with location/prop).
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { submitTask } from "@/lib/task/submit";
import { TASK_TYPE } from "@/lib/task/types";

export const POST = withAuth(
  async ({ userId, params, req }) => {
    const character = await prisma.character.findFirst({ where: { id: params.id, userId } });
    if (!character) throw new ApiError("NOT_FOUND", 404);
    const body = (await req.json().catch(() => ({}))) as { face?: boolean; view?: number };

    if (body.face) {
      if (!character.lockedImageMediaId) {
        throw new ApiError("NO_LOCKED_IMAGE", 400, "先鎖定一張圖先可以生成近臉特寫");
      }
      return ok(
        await submitTask({
          userId,
          type: TASK_TYPE.IMAGE_CHARACTER,
          targetType: "character",
          targetId: character.id,
          projectId: character.projectId,
          payload: { face: true },
          dedupeActive: true,
        }),
      );
    }

    if (typeof body.view === "number") {
      if (!character.locked || !character.lockedImageMediaId) {
        throw new ApiError("NO_LOCKED_IMAGE", 400, "先鎖定主圖先可以生成視圖");
      }
      const views = (character.views as unknown[] | null) ?? [];
      if (!Number.isInteger(body.view) || body.view < 0 || body.view >= views.length) {
        throw new ApiError("INVALID_VIEW", 400, "視圖編號無效");
      }
      return ok(
        await submitTask({
          userId,
          type: TASK_TYPE.IMAGE_CHARACTER,
          targetType: "character",
          targetId: character.id,
          projectId: character.projectId,
          payload: { view: body.view, at: Date.now() },
          dedupeActive: true,
        }),
      );
    }

    if (character.locked) {
      throw new ApiError("LOCKED", 400, "已鎖定——想重生請先解鎖（重新揀圖）");
    }
    return ok(
      await submitTask({
        userId,
        type: TASK_TYPE.IMAGE_CHARACTER,
        targetType: "character",
        targetId: character.id,
        projectId: character.projectId,
        payload: { at: Date.now() },
        dedupeActive: true, // repeat clicks while one runs reuse the task
      }),
    );
  },
  { auditAction: "character.regenerate" },
);
