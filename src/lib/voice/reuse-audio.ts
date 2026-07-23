// Carry already-generated TTS audio across a re-run of VOICE_ANALYZE so an edit
// to one line does not re-bill the whole episode's TTS.
//
// The reuse key must include EVERY input that changes the synthesized audio, not
// just the text — ttsLineHandler feeds the provider `content` AND `emotion` /
// `emotionStrength` (and the character's voice). If the key were (speaker,
// content) only, re-analysing a line whose text is unchanged but whose emotion
// flipped calm→angry would inherit the old clip and skip re-synthesis, so the
// new emotion would never be rendered. Callers must pass the SAME normalized
// emotionStrength they persist (capped at 0.5) on both sides.
//
// Buckets are consumed with shift(), so two identical lines each take a distinct
// clip and any surplus falls through to null — a clip is never reused twice.

export interface ReuseVoiceLine {
  speaker: string;
  content: string;
  emotion: string;
  emotionStrength: number;
}

export interface ExistingVoiceLine extends ReuseVoiceLine {
  audioMediaId: string | null;
}

const key = (l: ReuseVoiceLine) =>
  [
    l.speaker.normalize("NFKC").trim(),
    l.content.normalize("NFKC").trim(),
    l.emotion.normalize("NFKC").trim(),
    l.emotionStrength.toFixed(2),
  ].join("");

export function matchReusableAudio(existing: ExistingVoiceLine[], incoming: ReuseVoiceLine[]): (string | null)[] {
  const pool = new Map<string, string[]>();
  for (const e of existing) {
    if (!e.audioMediaId) continue;
    const k = key(e);
    const bucket = pool.get(k);
    if (bucket) bucket.push(e.audioMediaId);
    else pool.set(k, [e.audioMediaId]);
  }
  return incoming.map((line) => pool.get(key(line))?.shift() ?? null);
}
