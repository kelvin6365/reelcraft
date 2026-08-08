import type { StageKey } from "@/ui/types";

// Order matches the actual pipeline (computeNextAction / computeStages): the
// script is rewritten from the raw novel FIRST, then assets are extracted from
// that script (extractAssetsHandler reads scriptText ?? rawText). The rail used
// to show 資產 before 劇本 — the stale design-doc order — which read as "do
// station 2 before station 3" when execution is the reverse.
export const STATIONS: { key: StageKey; index: number; name: string; dom: string; hint: string }[] = [
  { key: "input", index: 1, name: "原文", dom: "station-input", hint: "你貼嘅原文喺呢度做底，唯讀；下一站會由佢改寫成劇本。" },
  { key: "script", index: 2, name: "劇本", dom: "station-script", hint: "AI 將原文改寫成分場劇本，可以手動執字；跟住由劇本抽角色同場景。" },
  { key: "assets", index: 3, name: "資產", dom: "station-assets", hint: "鎖定每個角色／場景一張定裝圖，之後所有鏡頭都用佢保持樣貌一致。" },
  { key: "storyboard", index: 4, name: "分鏡", dom: "station-storyboard", hint: "導演組把劇本拆成逐個鏡頭；確認分鏡先會開始使錢出圖。" },
  { key: "images", index: 5, name: "圖像", dom: "station-images", hint: "逐鏡出圖，做視頻底；每鏡出一張定裝圖做後續 i2v 起點。" },
  // 配音行喺視頻之前 —— 每鏡幾長要由真實音檔長度決定，唔係由字數估。估錯咗
  // 就要喺成片時凍幀補時或者硬截斷，兩樣都係「配音同畫面對唔上」。
  { key: "voice", index: 6, name: "配音", dom: "station-voice", hint: "先派音色（一角一聲），再逐句配音；出咗音先知每鏡真正要幾長。" },
  { key: "videos", index: 7, name: "視頻", dom: "station-videos", hint: "由每鏡靜態圖生成動態視頻（i2v），長度跟返該鏡配音嘅真實長度。" },
  { key: "export", index: 8, name: "成片", dom: "station-export", hint: "拼合鏡頭、配音同字幕，輸出最終 MP4 成片。" },
];

export const STATION_BY_KEY = Object.fromEntries(STATIONS.map((s) => [s.key, s])) as Record<
  StageKey,
  (typeof STATIONS)[number]
>;
