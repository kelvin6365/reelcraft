import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";

export const GET = withAuth(async ({ userId }) => {
  const projects = await prisma.project.findMany({
    where: { userId },
    orderBy: { lastAccessedAt: "desc" },
    include: { episodes: { select: { id: true, episodeNumber: true, status: true, updatedAt: true } } },
  });
  return ok(projects);
});

export const POST = withAuth(
  async ({ userId, req }) => {
    const body = (await req.json()) as { name?: string; stylePackId?: string; videoRatio?: string; inputType?: string };
    if (!body.name?.trim()) throw new ApiError("BAD_REQUEST", 400, "name required");
    const project = await prisma.project.create({
      data: {
        id: newId(),
        userId,
        name: body.name.trim(),
        stylePackId: body.stylePackId ?? "cinematic-01",
        videoRatio: body.videoRatio ?? "9:16",
        inputType: body.inputType ?? "novel",
      },
    });
    return ok(project, 201);
  },
  { auditAction: "project.create" },
);
