import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { planReindex } from "@/lib/storyboard/reindex";

export const PATCH = withAuth(
  async ({ userId, params, req }) => {
    const shot = await prisma.shot.findFirst({ where: { id: params.id, userId } });
    if (!shot) throw new ApiError("NOT_FOUND", 404);
    const body = (await req.json()) as Partial<{ imagePrompt: string; videoPrompt: string; storyboardJson: object; durationMs: number }>;
    const updated = await prisma.shot.update({
      where: { id: shot.id },
      data: {
        imagePrompt: body.imagePrompt,
        videoPrompt: body.videoPrompt,
        storyboardJson: body.storyboardJson,
        durationMs: body.durationMs,
      },
    });
    return ok(updated);
  },
  { auditAction: "shot.edit" },
);

// Delete a shot and close the gap so the remaining shots stay 1..N. Any
// generated image/video on it is discarded (the MediaObject rows are left as
// orphans, same as every other regenerate path — cleanup is a separate concern).
// voiceLine.matchedShotId is onDelete: SetNull, so bound dialogue survives with
// its binding cleared rather than cascading away.
export const DELETE = withAuth(
  async ({ userId, params }) => {
    const shot = await prisma.shot.findFirst({ where: { id: params.id, userId }, select: { id: true, episodeId: true } });
    if (!shot) throw new ApiError("NOT_FOUND", 404);

    const result = await prisma.$transaction(async (tx) => {
      await tx.shot.delete({ where: { id: shot.id } });
      const remaining = await tx.shot.findMany({
        where: { episodeId: shot.episodeId },
        select: { id: true, shotIndex: true },
        orderBy: { shotIndex: "asc" },
      });
      // Ascending target order avoids a transient unique-collision on
      // (episodeId, shotIndex) — see planReindex.
      for (const move of planReindex(remaining)) {
        await tx.shot.update({ where: { id: move.id }, data: { shotIndex: move.shotIndex } });
      }
      return { deleted: shot.id, remaining: remaining.length };
    });
    return ok(result);
  },
  { auditAction: "shot.delete" },
);
