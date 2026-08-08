// 呢一集嘅「配音表」—— 由對白行反推有幾多把聲要派，每把派咗未。
// 配音站 UI、next-action 個 gate、voice_cast AI 派音三處共用。Pure。
//
// 一把聲 = 一個 speaker 名。有 Character 對得上就跟角色（跨集共用同一把聲）；
// 對唔上（旁白／【機械音】／【系統】／「未知」）就係集級 speakerVoices 嗰邊。

import { parseSpeakerVoices, type SpeakerVoiceMap } from "@/lib/voice/binding";
import { getVoicePreset } from "@/lib/voice/presets";

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

export interface RawAssignment {
  speaker: string;
  voiceId: string;
  reason: string;
}

export interface AppliedAssignment {
  speaker: string;
  characterId: string | null;
  presetId: string;
  reason: string;
}

// 收貨 voice_cast 嘅輸出。模型會杜撰音色 id、會派畀唔存在嘅 speaker、會漏人、
// 會重複派同一個 speaker —— 逐個驗，壞嗰個丟走而唔係炸咗成次派音（重跑一次
// 又要俾多次錢，而且多數只係一兩個 assignment 有問題）。
export function applyCastAssignments(
  cast: CastRow[],
  assignments: RawAssignment[],
): { applied: AppliedAssignment[]; rejected: string[] } {
  const bySpeaker = new Map(cast.map((row) => [row.speaker, row]));
  const applied: AppliedAssignment[] = [];
  const rejected: string[] = [];
  const done = new Set<string>();

  for (const a of assignments) {
    const row = bySpeaker.get(a.speaker);
    if (!row) {
      rejected.push(`${a.speaker} → ${a.voiceId}（唔喺本集聲源清單）`);
      continue;
    }
    if (done.has(a.speaker)) {
      rejected.push(`${a.speaker} → ${a.voiceId}（同一個聲源派多過一次，取第一個）`);
      continue;
    }
    if (!getVoicePreset(a.voiceId)) {
      rejected.push(`${a.speaker} → ${a.voiceId}（唔喺音色庫）`);
      continue;
    }
    done.add(a.speaker);
    applied.push({
      speaker: row.speaker,
      characterId: row.characterId,
      presetId: a.voiceId,
      reason: a.reason.slice(0, 300),
    });
  }

  for (const row of cast) {
    if (!done.has(row.speaker) && !row.assigned) rejected.push(`${row.speaker}（AI 冇派到，要手動揀）`);
  }
  return { applied, rejected };
}
