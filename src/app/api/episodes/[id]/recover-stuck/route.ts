import { withAuth } from "@/lib/api/with-auth";
import { ok } from "@/lib/api/errors";
import { getOwnedEpisode } from "@/lib/api/episode-actions";
import { recoverOrphanedQueued } from "@/lib/task/recover";
import { reapLeakedSlots } from "@/lib/quota/reap-leaked";

// Recover an episode whose tasks are "stuck 生成中 forever":
//  1) free per-user concurrency slots a crashed/reloaded worker leaked
//     (reapLeakedSlots — safe zero-processing signal);
//  2) re-enqueue any queued task whose BullMQ job actually vanished.
export const POST = withAuth(
  async ({ userId, params }) => {
    const episode = await getOwnedEpisode(userId, params.id);
    const { image, video } = await reapLeakedSlots(userId);
    const recovered = await recoverOrphanedQueued({ episodeId: episode.id });
    return ok({ slotsFreed: image + video, ...recovered });
  },
  { auditAction: "episode.recover-stuck" },
);
