// 對白長度 → 鏡頭時長估算。純 code heuristic（唔改 prompt asset，避免 canary churn）。
// 語速 ~150 字/分鐘 → 400ms/字；加 ~800ms 動作緩衝；clamp [2000, 15000]——
// 15s 上限啱好係 Seedance durationsSec grid 嘅頂（standards/capabilities.json）。
// SRT 路線唔行呢度（cue 長度本身就係真時長）。

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
