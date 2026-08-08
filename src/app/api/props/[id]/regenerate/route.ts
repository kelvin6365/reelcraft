// Regenerate a prop's candidate images (parity with location/character regenerate).
// view:number → regenerate one white-bg view image, using the locked main image
// as reference. effectVideo:true (tier=effect only, must be locked) → generate the
// dynamic reference clip.
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { submitTask } from "@/lib/task/submit";
import { TASK_TYPE } from "@/lib/task/types";

export const POST = withAuth(
  async ({ userId, params, req }) => {
    const prop = await prisma.prop.findFirst({ where: { id: params.id, userId } });
    if (!prop) throw new ApiError("NOT_FOUND", 404);
    const body = (await req.json().catch(() => ({}))) as { view?: number; effectVideo?: boolean };

    if (body.effectVideo === true) {
      if (prop.tier !== "effect") throw new ApiError("BAD_REQUEST", 400, "effectVideo 只限 tier=effect 嘅道具");
      if (!prop.locked || !prop.lockedImageMediaId) throw new ApiError("NO_LOCKED_IMAGE", 400, "先鎖定靜態參考圖先可以生成動態片段");
      return ok(
        await submitTask({
          userId,
          type: TASK_TYPE.VIDEO_PROP,
          targetType: "prop",
          targetId: prop.id,
          projectId: prop.projectId,
          payload: { at: Date.now() },
          dedupeActive: true,
        }),
      );
    }

    if (typeof body.view === "number") {
      if (!prop.locked || !prop.lockedImageMediaId) {
        throw new ApiError("NO_LOCKED_IMAGE", 400, "先鎖定主圖先可以生成視角圖");
      }
      const views = (prop.views as unknown[] | null) ?? [];
      if (!Number.isInteger(body.view) || body.view < 0 || body.view >= views.length) {
        throw new ApiError("INVALID_VIEW", 400, "視角編號無效");
      }
    } else if (prop.locked) {
      throw new ApiError("LOCKED", 400, "已鎖定——想重生請先解鎖（重新揀圖）");
    }
    return ok(
      await submitTask({
        userId,
        type: TASK_TYPE.IMAGE_PROP,
        targetType: "prop",
        targetId: prop.id,
        projectId: prop.projectId,
        payload: typeof body.view === "number" ? { view: body.view, at: Date.now() } : { at: Date.now() },
        dedupeActive: true, // repeat clicks while one runs reuse the task; view vs main-image share the same mutex — acceptable, they touch the same card
      }),
    );
  },
  { auditAction: "prop.regenerate" },
);
