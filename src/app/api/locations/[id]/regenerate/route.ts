// Regenerate a location's candidate images (parity with character regenerate).
// angle:number branch generates/regenerates one 16:9 angle-view image, using the
// locked main image as reference to keep the same location consistent across views.
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { submitTask } from "@/lib/task/submit";
import { TASK_TYPE } from "@/lib/task/types";

export const POST = withAuth(
  async ({ userId, params, req }) => {
    const location = await prisma.location.findFirst({ where: { id: params.id, userId } });
    if (!location) throw new ApiError("NOT_FOUND", 404);
    const body = (await req.json().catch(() => ({}))) as { angle?: number };
    if (typeof body.angle === "number") {
      if (!location.locked || !location.lockedImageMediaId) {
        throw new ApiError("NO_LOCKED_IMAGE", 400, "先鎖定主圖先可以生成視角圖");
      }
      const angles = (location.angles as unknown[] | null) ?? [];
      if (!Number.isInteger(body.angle) || body.angle < 0 || body.angle >= angles.length) {
        throw new ApiError("INVALID_ANGLE", 400, "視角編號無效");
      }
    } else if (location.locked) {
      throw new ApiError("LOCKED", 400, "已鎖定——想重生請先解鎖（重新揀圖）");
    }
    return ok(
      await submitTask({
        userId,
        type: TASK_TYPE.IMAGE_LOCATION,
        targetType: "location",
        targetId: location.id,
        projectId: location.projectId,
        payload: typeof body.angle === "number" ? { angle: body.angle, at: Date.now() } : { at: Date.now() },
        dedupeActive: true, // repeat clicks while one runs reuse the task; angle vs main-image share the same mutex — acceptable, they touch the same card
      }),
    );
  },
  { auditAction: "location.regenerate" },
);
