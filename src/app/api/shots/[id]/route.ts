import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";

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
