import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ok } from "@/lib/api/errors";
import { getOwnedEpisode } from "@/lib/api/episode-actions";
import { recoverOrphanedQueued } from "@/lib/task/recover";
import { reapStaleSlots } from "@/lib/quota/gate";
import { TASK_TYPE } from "@/lib/task/types";

// The tasks that hold a per-user gate slot on each scope's queue.
const IMAGE_TYPES = [TASK_TYPE.IMAGE_CHARACTER, TASK_TYPE.IMAGE_LOCATION, TASK_TYPE.IMAGE_SHOT];
const VIDEO_TYPES = [TASK_TYPE.VIDEO_SHOT, TASK_TYPE.COMPOSE_EPISODE];

// Recover an episode whose tasks are "stuck 生成中 forever":
//  1) free per-user concurrency slots leaked by a crashed/reloaded worker.
//     A slot is only provably leaked when the user has NO processing task in
//     that scope — then every held slot belongs to a dead worker. We deliberately
//     do NOT reap on age: a video legitimately generates up to TASK_MAX_RUNTIME_MS
//     (15 min), so an age threshold either kills live jobs or never beats the
//     gate's own 15-min TTL. Zero-processing is the safe, exact signal.
//  2) re-enqueue any queued task whose BullMQ job actually vanished.
export const POST = withAuth(
  async ({ userId, params }) => {
    const episode = await getOwnedEpisode(userId, params.id);
    // Slots are per-user (across all episodes), so count this user's processing
    // tasks per scope everywhere, not just in this episode.
    const [imageProcessing, videoProcessing] = await Promise.all([
      prisma.task.count({ where: { userId, status: "processing", type: { in: IMAGE_TYPES } } }),
      prisma.task.count({ where: { userId, status: "processing", type: { in: VIDEO_TYPES } } }),
    ]);
    // olderThanMs: 0 → reap every slot in the scope. Only reached when nothing is
    // processing, so no live job's slot is touched.
    const [image, video] = await Promise.all([
      imageProcessing === 0 ? reapStaleSlots(userId, "image", 0) : Promise.resolve(0),
      videoProcessing === 0 ? reapStaleSlots(userId, "video", 0) : Promise.resolve(0),
    ]);
    const recovered = await recoverOrphanedQueued({ episodeId: episode.id });
    return ok({ slotsFreed: image + video, ...recovered });
  },
  { auditAction: "episode.recover-stuck" },
);
