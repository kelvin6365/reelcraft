import { withAuth } from "@/lib/api/with-auth";
import { ok } from "@/lib/api/errors";
import { getOwnedEpisode } from "@/lib/api/episode-actions";
import { parseShotIds, submitShotMediaBatch } from "@/lib/api/shot-batch";

export const POST = withAuth(
  async ({ userId, params, req }) => {
    const episode = await getOwnedEpisode(userId, params.id);
    const shotIds = parseShotIds(await req.json().catch(() => null));
    return ok(await submitShotMediaBatch({ userId, episode, media: "image", shotIds }));
  },
  { auditAction: "episode.generate-shot-images" },
);
