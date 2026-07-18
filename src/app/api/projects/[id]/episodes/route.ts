import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";

export const POST = withAuth(
  async ({ userId, params, req }) => {
    const project = await prisma.project.findFirst({ where: { id: params.id, userId } });
    if (!project) throw new ApiError("NOT_FOUND", 404);
    const body = (await req.json()) as { rawText?: string };
    if (!body.rawText?.trim()) throw new ApiError("BAD_REQUEST", 400, "rawText required");

    const last = await prisma.episode.findFirst({ where: { projectId: project.id }, orderBy: { episodeNumber: "desc" } });
    const episode = await prisma.episode.create({
      data: {
        id: newId(),
        userId,
        projectId: project.id,
        episodeNumber: (last?.episodeNumber ?? 0) + 1,
        rawText: body.rawText.trim(),
        status: "draft",
      },
    });
    return ok(episode, 201);
  },
  { auditAction: "episode.create" },
);
