// The ✋ asset review gate for locations.
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { advanceAfterTask } from "@/lib/batch/advance";

export const POST = withAuth(
  async ({ userId, params, req }) => {
    const row = await prisma.location.findFirst({ where: { id: params.id, userId } });
    if (!row) throw new ApiError("NOT_FOUND", 404);
    const body = (await req.json()) as { mediaId?: string; unlock?: boolean };
    if (body.unlock) {
      await prisma.location.update({ where: { id: row.id }, data: { locked: false } });
      return ok({ locked: false });
    }
    if (!body.mediaId || !(row.candidates as string[]).includes(body.mediaId)) {
      throw new ApiError("BAD_REQUEST", 400, "mediaId must be one of the candidates");
    }
    await prisma.location.update({ where: { id: row.id }, data: { lockedImageMediaId: body.mediaId, locked: true } });
    // Assets are project-level (shared across episodes) — kick every autorun
    // episode in the project so a lock can unblock a stalled 揀圖 gate.
    const episodes = await prisma.episode.findMany({ where: { projectId: row.projectId, autorun: true }, select: { id: true } });
    for (const e of episodes) advanceAfterTask(e.id);
    return ok({ locked: true });
  },
  { auditAction: "asset.lock" },
);
