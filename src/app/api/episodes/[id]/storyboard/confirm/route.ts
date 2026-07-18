// The ✋ storyboard review gate: advancing status past "storyboard" unlocks images.
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { getOwnedEpisode } from "@/lib/api/episode-actions";

export const POST = withAuth(
  async ({ userId, params }) => {
    const episode = await getOwnedEpisode(userId, params.id);
    const shots = await prisma.shot.count({ where: { episodeId: episode.id } });
    if (shots === 0) throw new ApiError("NO_SHOTS", 400, "generate the storyboard first");
    await prisma.episode.update({ where: { id: episode.id }, data: { status: "images" } });
    return ok({ confirmed: true, shots });
  },
  { auditAction: "storyboard.confirm" },
);
