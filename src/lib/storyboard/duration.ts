// 對白長度 → 鏡頭時長估算。純 code heuristic（唔改 prompt asset，避免 canary churn）。
// 語速 ~150 字/分鐘 → 400ms/字；加 ~800ms 動作緩衝；clamp [2000, 15000]——
// 15s 上限啱好係 Seedance durationsSec grid 嘅頂（standards/capabilities.json）。
// SRT 路線唔行呢度（cue 長度本身就係真時長）。
//
// ⚠️ 字數估算只係「未有配音之前」嘅暫定值。配音出咗之後由 shotDurationFromAudio
// 用實際音長覆寫，先至係餵去 i2v 嗰個長度。
import { placeLines } from "@/lib/timeline/placement";

const MS_PER_CHAR = 400;
const ACTION_BUFFER_MS = 800;
const MIN_MS = 2000;
const MAX_MS = 15_000;
const NO_DIALOGUE_MS = 3000; // 冇對白鏡照舊 3s

export function estimateShotDurationMs(dialogue: string | undefined): number {
  const chars = (dialogue ?? "").trim().length;
  if (chars === 0) return NO_DIALOGUE_MS;
  return Math.min(MAX_MS, Math.max(MIN_MS, chars * MS_PER_CHAR + ACTION_BUFFER_MS));
}

// 講完最後一句到切鏡之間嘅呼吸位。一收咪即刻切，觀感好似被人打斷。
const TAIL_MS = 700;

// 真音長驅動：TTS 出咗之後，鏡頭應該幾長就唔使再靠字數估 —— 用實際音檔長度。
// 呢個係「配音同視頻對唔上」嘅治本一步：以前係先估字數生片，再夾硬把音塞入
// 一段長度唔啱嘅片（唔夠就凍幀補時、封頂之後直接截斷；有餘就鏡頭喺度靜音郁）。
//
// 位置計算行返 placeLines（同 compose／預覽時間軸同一個 module），因為用戶喺
// 成片時間軸拖過 chip（offsetMs）之後，最遲收工嗰句唔一定係最後一句。
export function shotDurationFromAudio(
  lines: { id: string; lineIndex: number; offsetMs: number | null; audioDurationMs: number }[],
  fallbackMs: number,
): number {
  if (lines.length === 0) return fallbackMs;
  // 傳一個大到唔可能嘅 shotDurationMs：佢淨係影響 truncatedAtMs 標記，唔影響位置
  const placed = placeLines(lines, Number.MAX_SAFE_INTEGER);
  const endMs = placed.reduce((m, p) => Math.max(m, p.endMs), 0);
  if (endMs <= 0) return fallbackMs;
  return Math.min(MAX_MS, Math.max(MIN_MS, endMs + TAIL_MS));
}
