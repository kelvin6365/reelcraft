// SRT subtitle parser — pure and deterministic (no LLM for structure, per M2-T3
// design). Tolerant of BOM, CRLF/CR line endings, missing cue indices, and
// multi-line cue text. Throws a terminal BAD_SRT TaskError when nothing parses.
import { TaskError } from "@/lib/task/types";

export interface SrtCue {
  index: number; // 1-based order in the file (re-numbered, not the file's own index)
  startMs: number;
  endMs: number;
  text: string; // cue text; multi-line cues joined with "\n"
}

// HH:MM:SS,mmm --> HH:MM:SS,mmm — hours optional-width, ms via ',' or '.'.
const TIMECODE = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function toMs(h: string, m: string, s: string, ms: string): number {
  return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(ms.padEnd(3, "0"));
}

export function parseSrt(input: string): SrtCue[] {
  const normalized = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const blocks = normalized.split(/\n{2,}/);
  const cues: SrtCue[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trimEnd());
    const tcIdx = lines.findIndex((l) => TIMECODE.test(l));
    if (tcIdx === -1) continue; // no timecode → not a cue (index-only or junk block)

    const m = TIMECODE.exec(lines[tcIdx])!;
    const startMs = toMs(m[1], m[2], m[3], m[4]);
    const endMs = toMs(m[5], m[6], m[7], m[8]);
    const text = lines
      .slice(tcIdx + 1)
      .join("\n")
      .trim();
    if (!text) continue; // empty cue text → skip

    cues.push({ index: cues.length + 1, startMs, endMs, text });
  }

  if (cues.length === 0) throw new TaskError("BAD_SRT", "no valid SRT cues found in input", false);
  return cues;
}
