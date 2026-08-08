// Reap per-user concurrency slots that a crashed/reloaded worker left behind.
//
// A slot is only PROVABLY leaked when the user has no processing task in that
// scope — then every held slot belonged to a dead worker. We never reap on age:
// a video legitimately generates up to TASK_MAX_RUNTIME_MS (15 min), so an age
// threshold either kills live jobs or never beats the gate's own 15-min TTL.
//
// Shared by the manual 重新排隊 recovery (recover-stuck route) and the watchdog's
// zombie cleanup, so a worker restart auto-frees the slots its dead predecessor
// held instead of the user waiting out the TTL.
import { prisma } from "@/lib/db";
import { reapStaleSlots } from "@/lib/quota/gate";
import { TASK_TYPE } from "@/lib/task/types";

const IMAGE_TYPES = [TASK_TYPE.IMAGE_CHARACTER, TASK_TYPE.IMAGE_LOCATION, TASK_TYPE.IMAGE_PROP, TASK_TYPE.IMAGE_SHOT];
const VIDEO_TYPES = [TASK_TYPE.VIDEO_SHOT, TASK_TYPE.VIDEO_PROP, TASK_TYPE.COMPOSE_EPISODE];

export async function reapLeakedSlots(userId: string): Promise<{ image: number; video: number }> {
  const [imageProcessing, videoProcessing] = await Promise.all([
    prisma.task.count({ where: { userId, status: "processing", type: { in: IMAGE_TYPES } } }),
    prisma.task.count({ where: { userId, status: "processing", type: { in: VIDEO_TYPES } } }),
  ]);
  // olderThanMs: 0 → reap every slot in the scope; only reached when nothing is
  // processing, so no live job's slot is touched.
  const [image, video] = await Promise.all([
    imageProcessing === 0 ? reapStaleSlots(userId, "image", 0) : Promise.resolve(0),
    videoProcessing === 0 ? reapStaleSlots(userId, "video", 0) : Promise.resolve(0),
  ]);
  return { image, video };
}
