// 派音寫入嘅共用規則 —— 角色派音（characters/[id]/voice）同 AI 派音
// （VOICE_CAST handler）都行呢度，唔准各自寫一份。
//
// 換音色 = 已生成嘅音檔即刻作廢：舊音檔係用舊音色合成嘅，留住就等於用戶
// 「換咗音色但把聲冇變」。清 audioMediaId 而唔係即刻重配 —— 幾時使錢重配
// 由用戶／autorun 決定，唔喺 PATCH 度靜靜燒錢。

import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api/errors";
import { getVoicePreset } from "@/lib/voice/presets";

export interface VoicePatch {
  presetId: string | null;
  refId: string | null;
}

// 二選一：兩個都有值係矛盾指令，唔准靜默揀一個。
export async function validateVoicePatch(
  userId: string,
  projectId: string,
  raw: { presetId?: unknown; refId?: unknown },
): Promise<VoicePatch> {
  const presetId = typeof raw.presetId === "string" && raw.presetId ? raw.presetId : null;
  const refId = typeof raw.refId === "string" && raw.refId ? raw.refId : null;
  if (presetId && refId) throw new ApiError("BAD_REQUEST", 400, "presetId 同 refId 只可以擇其一");
  if (presetId && !getVoicePreset(presetId)) {
    throw new ApiError("BAD_REQUEST", 400, `音色 ${presetId} 唔喺音色庫入面`);
  }
  if (refId) {
    const voice = await prisma.voice.findFirst({ where: { id: refId, userId, projectId }, select: { id: true } });
    if (!voice) throw new ApiError("NOT_FOUND", 404, "參考音搵唔到");
  }
  return { presetId, refId };
}

// 清走某角色所有已生成配音（跨集）——換音色之後嗰啲音檔已經唔代表該角色。
export async function invalidateCharacterAudio(characterId: string): Promise<number> {
  const { count } = await prisma.voiceLine.updateMany({
    where: { characterId, audioMediaId: { not: null } },
    data: { audioMediaId: null },
  });
  return count;
}

// 同上，但係針對冇 Character 嘅 speaker（旁白／機械音／未知），只限該集。
export async function invalidateSpeakerAudio(episodeId: string, speaker: string): Promise<number> {
  const { count } = await prisma.voiceLine.updateMany({
    where: { episodeId, speaker, characterId: null, audioMediaId: { not: null } },
    data: { audioMediaId: null },
  });
  return count;
}
