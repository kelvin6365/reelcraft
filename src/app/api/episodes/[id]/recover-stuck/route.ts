import { withAuth } from "@/lib/api/with-auth";
import { ok } from "@/lib/api/errors";
import { getOwnedEpisode } from "@/lib/api/episode-actions";
import { recoverOrphanedQueued } from "@/lib/task/recover";
import { reapStaleSlots } from "@/lib/quota/gate";

// Anything a job's slot could still legitimately be held for is far under this —
// a real image gen is seconds, a video a couple of minutes. A slot older than
// this is a leak from a worker that died mid-job, so reaping it here is safe and
// is what actually unsticks the user (the queue's own reap waits 15 min).
const LEAKED_SLOT_MS = 3 * 60_000;

// Recover an episode whose tasks are "stuck 生成中 forever":
//  1) free per-user concurrency slots leaked by a crashed/reloaded worker —
//     the usual dev cause; without this the user's image/video queue is starved
//     until the 15-minute gate TTL expires.
//  2) re-enqueue any queued task whose BullMQ job actually vanished.
export const POST = withAuth(
  async ({ userId, params }) => {
    const episode = await getOwnedEpisode(userId, params.id);
    const [image, video] = await Promise.all([
      reapStaleSlots(userId, "image", LEAKED_SLOT_MS),
      reapStaleSlots(userId, "video", LEAKED_SLOT_MS),
    ]);
    const recovered = await recoverOrphanedQueued({ episodeId: episode.id });
    return ok({ slotsFreed: image + video, ...recovered });
  },
  { auditAction: "episode.recover-stuck" },
);
