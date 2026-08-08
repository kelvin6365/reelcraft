// 配音批量提交 —— 對應 shot-batch.ts 之於圖像／視頻站。
//
// 兩種語義，同圖像站一致：
//   lineIds = null  → 補配（只做未有音檔嗰啲），一鍵配音／SRT 路線用
//   lineIds 有值    → 重配呢批（唔理有冇音檔），批量重配用
//
// 三種行會被剔走，唔會排隊：空台詞（配咗都係錯，仲要白畀錢）、未派音色
// （行到 worker 一定 VOICE_NOT_CAST 失敗）、以及唔屬於呢一集嘅 id。

import { prisma } from "@/lib/db";
import { submitTask } from "@/lib/task/submit";
import { TASK_TYPE } from "@/lib/task/types";
import { filterCastableLines } from "@/lib/voice/castable";

// 遠高於任何一集嘅實際對白數，正常選取唔會被截 —— 個 cap 只係擋偽造 body
// 送一條巨型 IN (...) 落嚟。同 shot-batch.ts 同一個理由、同一個數。
const MAX_LINE_IDS = 1000;

export function parseLineIds(body: unknown): string[] | null {
  const ids = (body as { lineIds?: unknown } | null)?.lineIds;
  if (!Array.isArray(ids)) return null;
  const clean = ids.filter((id): id is string => typeof id === "string" && id.length > 0).slice(0, MAX_LINE_IDS);
  return clean.length > 0 ? clean : null;
}

export interface VoiceBatchResult {
  submitted: number;
  skippedEmpty: number;
  skippedUncast: number;
}

export async function submitVoiceLineBatch({
  userId,
  episode,
  lineIds,
}: {
  userId: string;
  episode: { id: string; projectId: string; speakerVoices: unknown };
  lineIds: string[] | null;
}): Promise<VoiceBatchResult> {
  const candidates = await prisma.voiceLine.findMany({
    where: {
      episodeId: episode.id,
      userId,
      ...(lineIds ? { id: { in: lineIds } } : { audioMediaId: null }),
    },
    orderBy: { lineIndex: "asc" },
    select: { id: true, content: true, speaker: true, characterId: true },
  });

  const nonEmpty = candidates.filter((l) => l.content.trim().length > 0);
  const castable = await filterCastableLines(episode, nonEmpty);

  for (const line of castable) {
    await submitTask({
      userId,
      type: TASK_TYPE.TTS_LINE,
      targetType: "voiceLine",
      targetId: line.id,
      projectId: episode.projectId,
      episodeId: episode.id,
      payload: { at: Date.now() },
      // 撳兩下唔好俾兩次錢 —— 摺埋落已經行緊嗰個 task
      dedupeActive: true,
    });
  }

  return {
    submitted: castable.length,
    skippedEmpty: candidates.length - nonEmpty.length,
    skippedUncast: nonEmpty.length - castable.length,
  };
}
