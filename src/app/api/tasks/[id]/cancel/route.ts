import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { publishTaskEvent } from "@/lib/task/events";

export const POST = withAuth(
  async ({ userId, params }) => {
    const task = await prisma.task.findFirst({ where: { id: params.id, userId } });
    if (!task) throw new ApiError("NOT_FOUND", 404);
    const updated = await prisma.task.updateMany({
      where: { id: task.id, status: { in: ["queued", "processing"] } },
      data: { status: "canceled", finishedAt: new Date() },
    });
    if (updated.count === 0) throw new ApiError("NOT_ACTIVE", 400, "task is not active");
    publishTaskEvent(task.projectId, { taskId: task.id, taskType: task.type, eventType: "CANCELED" });
    return ok({ canceled: true });
  },
  { auditAction: "task.cancel" },
);
