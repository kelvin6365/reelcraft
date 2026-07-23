import { prisma } from "@/lib/db";
import { submitTask } from "@/lib/task/submit";
import { TASK_TYPE } from "@/lib/task/types";

// Well above any real episode's shot count (short drama tops out ~100 shots),
// so a legitimate selection is never truncated — the cap only defends against a
// forged body sending a giant IN (...) list.
const MAX_SHOT_IDS = 1000;

export function parseShotIds(body: unknown): string[] | null {
  const ids = (body as { shotIds?: unknown } | null)?.shotIds;
  if (!Array.isArray(ids)) return null;
  const clean = ids.filter((id): id is string => typeof id === "string" && id.length > 0).slice(0, MAX_SHOT_IDS);
  return clean.length > 0 ? clean : null;
}

export async function submitShotMediaBatch({
  userId,
  episode,
  media,
  shotIds,
}: {
  userId: string;
  episode: { id: string; projectId: string };
  media: "image" | "video";
  shotIds: string[] | null;
}): Promise<{ submitted: number; skipped: number }> {
  const isImage = media === "image";
  const shots = await prisma.shot.findMany({
    where: {
      episodeId: episode.id,
      ...(shotIds ? { id: { in: shotIds } } : isImage ? { imageMediaId: null } : { videoMediaId: null }),
      ...(isImage ? {} : { imageMediaId: { not: null } }),
    },
    select: { id: true },
  });

  for (const shot of shots) {
    await submitTask({
      userId,
      type: isImage ? TASK_TYPE.IMAGE_SHOT : TASK_TYPE.VIDEO_SHOT,
      targetType: "shot",
      targetId: shot.id,
      projectId: episode.projectId,
      episodeId: episode.id,
      payload: { at: Date.now() },
      dedupeActive: true,
    });
  }
  return { submitted: shots.length, skipped: shotIds ? shotIds.length - shots.length : 0 };
}
