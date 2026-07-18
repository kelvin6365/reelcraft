import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { getOwnedEpisode } from "@/lib/api/episode-actions";

export const PATCH = withAuth(
  async ({ userId, params, req }) => {
    const episode = await getOwnedEpisode(userId, params.id);
    const body = (await req.json()) as { scriptText?: string };
    if (typeof body.scriptText !== "string") throw new ApiError("BAD_REQUEST", 400, "scriptText required");
    await prisma.episode.update({ where: { id: episode.id }, data: { scriptText: body.scriptText } });
    return ok({ saved: true });
  },
  { auditAction: "script.edit" },
);
