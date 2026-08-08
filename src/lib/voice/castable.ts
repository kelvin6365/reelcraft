// 邊啲對白行而家配得成 —— fan out TTS 之前先篩，唔好開一堆注定
// VOICE_NOT_CAST 失敗嘅 task 出嚟嚇親用戶。

import { prisma } from "@/lib/db";
import { parseSpeakerVoices, resolveVoiceBinding } from "@/lib/voice/binding";

export interface CastableLine {
  speaker: string;
  characterId: string | null;
}

export async function filterCastableLines<T extends CastableLine>(
  episode: { projectId: string; speakerVoices: unknown },
  lines: T[],
): Promise<T[]> {
  if (lines.length === 0) return [];
  const [characters, voices] = await Promise.all([
    prisma.character.findMany({
      where: { projectId: episode.projectId },
      select: { id: true, voicePresetId: true, voiceRefId: true },
    }),
    prisma.voice.findMany({ where: { projectId: episode.projectId }, select: { id: true, audioMediaId: true } }),
  ]);
  const charById = new Map(characters.map((c) => [c.id, c]));
  const refAudioById = new Map(voices.map((v) => [v.id, v.audioMediaId]));
  const speakerVoices = parseSpeakerVoices(episode.speakerVoices);

  return lines.filter(
    (line) =>
      resolveVoiceBinding({
        speaker: line.speaker,
        character: line.characterId ? (charById.get(line.characterId) ?? null) : null,
        speakerVoices,
        refAudioById,
      }).ok,
  );
}
