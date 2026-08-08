// TTS 出咗之後，把該鏡嘅 durationMs 由「字數估算」改成「實際音長」。
// 之後 VIDEO_SHOT 就係跟真音長生片，唔使成片時再夾硬凍幀補時／截斷。
//
// 每句配音完成都行一次（增量收斂）：頭幾句完成時個值會偏短，最後一句完成
// 之後就係終值。而家配音站排喺視頻站之前，所以生片時一定係終值。

import { prisma } from "@/lib/db";
import { shotDurationFromAudio } from "@/lib/storyboard/duration";

export async function syncShotDurationFromAudio(shotId: string): Promise<number | null> {
  const shot = await prisma.shot.findUnique({ where: { id: shotId }, select: { id: true, durationMs: true } });
  if (!shot) return null;

  const lines = await prisma.voiceLine.findMany({
    where: { matchedShotId: shotId, audioMediaId: { not: null } },
    orderBy: { lineIndex: "asc" },
    select: { id: true, lineIndex: true, offsetMs: true, audioMedia: { select: { durationMs: true } } },
  });
  // durationMs 探測失敗（null）嘅音檔冇得計 —— 當佢唔存在好過用一個作出嚟嘅
  // 長度去定成個鏡頭幾長。
  const measured = lines
    .filter((l) => (l.audioMedia?.durationMs ?? 0) > 0)
    .map((l) => ({
      id: l.id,
      lineIndex: l.lineIndex,
      offsetMs: l.offsetMs,
      audioDurationMs: l.audioMedia!.durationMs!,
    }));
  if (measured.length === 0) return null;

  const next = shotDurationFromAudio(measured, shot.durationMs);
  if (next === shot.durationMs) return next;
  await prisma.shot.update({ where: { id: shot.id }, data: { durationMs: next } });
  return next;
}
