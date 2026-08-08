// 呢一集嘅「配音表」—— 由對白行反推有幾多把聲要派，每把派咗未。
// 配音站 UI、next-action 個 gate、voice_cast AI 派音三處共用。Pure。
//
// 一把聲 = 一個 speaker 名。有 Character 對得上就跟角色（跨集共用同一把聲）；
// 對唔上（旁白／【機械音】／【系統】／「未知」）就係集級 speakerVoices 嗰邊。

import { parseSpeakerVoices, type SpeakerVoiceMap } from "@/lib/voice/binding";

export interface CastLine {
  speaker: string;
  characterId: string | null;
}

export interface CastCharacter {
  id: string;
  name: string;
  voicePresetId: string | null;
  voiceRefId: string | null;
  voiceCastNote: string;
}

export interface CastRow {
  speaker: string;
  // null = 冇 Character，音色綁喺集級 speakerVoices
  characterId: string | null;
  lineCount: number;
  presetId: string | null;
  refId: string | null;
  note: string;
  assigned: boolean;
}

export function buildVoiceCast(
  lines: CastLine[],
  characters: CastCharacter[],
  rawSpeakerVoices: unknown,
): CastRow[] {
  const speakerVoices: SpeakerVoiceMap = parseSpeakerVoices(rawSpeakerVoices);
  const charById = new Map(characters.map((c) => [c.id, c]));

  // 同一個 speaker 名可能有啲行綁咗 characterId 有啲冇（voice_analyze 逐行判斷）。
  // 以「有 characterId」嗰個為準 —— 角色綁定係跨集嘅，比集級 fallback 強。
  const order: string[] = [];
  const byName = new Map<string, { characterId: string | null; lineCount: number }>();
  for (const line of lines) {
    const name = line.speaker || "未知";
    let row = byName.get(name);
    if (!row) {
      row = { characterId: null, lineCount: 0 };
      byName.set(name, row);
      order.push(name);
    }
    row.lineCount += 1;
    if (line.characterId && charById.has(line.characterId)) row.characterId = line.characterId;
  }

  return order.map((speaker) => {
    const row = byName.get(speaker)!;
    const character = row.characterId ? charById.get(row.characterId)! : null;
    const entry = character ? null : speakerVoices[speaker];
    const presetId = character
      ? character.voicePresetId
      : entry && "presetId" in entry
        ? entry.presetId
        : null;
    const refId = character ? character.voiceRefId : entry && "refId" in entry ? entry.refId : null;
    return {
      speaker,
      characterId: row.characterId,
      lineCount: row.lineCount,
      presetId,
      refId,
      note: character?.voiceCastNote ?? "",
      assigned: Boolean(presetId || refId),
    };
  });
}
