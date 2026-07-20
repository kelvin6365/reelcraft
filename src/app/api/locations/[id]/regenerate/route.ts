// Regenerate a location's candidate images (parity with character regenerate).
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { submitTask } from "@/lib/task/submit";
import { TASK_TYPE } from "@/lib/task/types";

export const POST = withAuth(
  async ({ userId, params }) => {
    const location = await prisma.location.findFirst({ where: { id: params.id, userId } });
    if (!location) throw new ApiError("NOT_FOUND", 404);
    return ok(
      await submitTask({
        userId,
        type: TASK_TYPE.IMAGE_LOCATION,
        targetType: "location",
        targetId: location.id,
        projectId: location.projectId,
        payload: { at: Date.now() },
        dedupeActive: true,
      }),
    );
  },
  { auditAction: "location.regenerate" },
);
