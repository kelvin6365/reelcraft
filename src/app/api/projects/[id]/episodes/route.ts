import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";

export const POST = withAuth(
  async ({ userId, params, req }) => {
    const project = await prisma.project.findFirst({ where: { id: params.id, userId } });
    if (!project) throw new ApiError("NOT_FOUND", 404);
    const body = (await req.json()) as { rawText?: string; force?: boolean };
    if (!body.rawText?.trim()) throw new ApiError("BAD_REQUEST", 400, "rawText required");
    const rawText = body.rawText.trim();

    // Duplicate-spend protection (M3 #11): identical source text pasted again
    // within 30 min is almost always an accidental re-run — block unless forced.
    if (!body.force) {
      const dupe = await prisma.episode.findFirst({
        where: { userId, rawText, createdAt: { gt: new Date(Date.now() - 30 * 60_000) } },
        select: { id: true, projectId: true },
      });
      if (dupe) {
        throw new ApiError(
          "DUPLICATE_EPISODE",
          409,
          "30 分鐘內已有一集用完全相同嘅原文（可能誤觸重複建立）。確定要再建，請帶 force:true。",
        );
      }
    }

    const last = await prisma.episode.findFirst({ where: { projectId: project.id }, orderBy: { episodeNumber: "desc" } });
    const episode = await prisma.episode.create({
      data: {
        id: newId(),
        userId,
        projectId: project.id,
        episodeNumber: (last?.episodeNumber ?? 0) + 1,
        rawText,
        status: "draft",
        autorun: true,
        autorunConfig: { mode: "assisted" },
      },
    });
    return ok(episode, 201);
  },
  { auditAction: "episode.create" },
);
