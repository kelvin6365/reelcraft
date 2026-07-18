// Task list — powers the failure drawer (?status=failed) and activity views.
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ok } from "@/lib/api/errors";

export const GET = withAuth(async ({ userId, req }) => {
  const episodeId = req.nextUrl.searchParams.get("episodeId") ?? undefined;
  const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const tasks = await prisma.task.findMany({
    where: { userId, episodeId, projectId, status },
    orderBy: { queuedAt: "desc" },
    take: 100,
    select: {
      id: true, type: true, status: true, progress: true, attempt: true,
      errorCode: true, errorMessage: true, targetType: true, targetId: true, queuedAt: true, finishedAt: true,
    },
  });
  return ok(tasks);
});
