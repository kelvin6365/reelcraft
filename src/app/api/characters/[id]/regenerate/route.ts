// Regenerate a character's candidate images. With keepIdentity:true and an
// existing locked image, the new candidates are conditioned on that image so the
// face stays fixed while pose/outfit varies (self-referencing — M2a).
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { submitTask } from "@/lib/task/submit";
import { TASK_TYPE } from "@/lib/task/types";

export const POST = withAuth(
  async ({ userId, params, req }) => {
    const character = await prisma.character.findFirst({ where: { id: params.id, userId } });
    if (!character) throw new ApiError("NOT_FOUND", 404);
    const body = (await req.json().catch(() => ({}))) as { keepIdentity?: boolean; face?: boolean };
    if ((body.keepIdentity || body.face) && !character.lockedImageMediaId) {
      throw new ApiError("NO_LOCKED_IMAGE", 400, body.face ? "先鎖定一張圖先可以生成近臉特寫" : "先鎖定一張圖先可以「保留身份重生」");
    }
    return ok(
      await submitTask({
        userId,
        type: TASK_TYPE.IMAGE_CHARACTER,
        targetType: "character",
        targetId: character.id,
        projectId: character.projectId,
        payload: body.face ? { face: true } : { at: Date.now(), keepIdentity: Boolean(body.keepIdentity) },
        dedupeActive: true, // repeat clicks while one runs reuse the task
      }),
    );
  },
  { auditAction: "character.regenerate" },
);
