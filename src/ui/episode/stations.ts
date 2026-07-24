import type { StageKey } from "@/ui/types";

// Order matches the actual pipeline (computeNextAction / computeStages): the
// script is rewritten from the raw novel FIRST, then assets are extracted from
// that script (extractAssetsHandler reads scriptText ?? rawText). The rail used
// to show 資產 before 劇本 — the stale design-doc order — which read as "do
// station 2 before station 3" when execution is the reverse.
export const STATIONS: { key: StageKey; index: number; name: string; dom: string }[] = [
  { key: "input", index: 1, name: "原文", dom: "station-input" },
  { key: "script", index: 2, name: "劇本", dom: "station-script" },
  { key: "assets", index: 3, name: "資產", dom: "station-assets" },
  { key: "storyboard", index: 4, name: "分鏡", dom: "station-storyboard" },
  { key: "images", index: 5, name: "圖像", dom: "station-images" },
  { key: "videos", index: 6, name: "視頻", dom: "station-videos" },
  { key: "voice", index: 7, name: "配音", dom: "station-voice" },
  { key: "export", index: 8, name: "成片", dom: "station-export" },
];

export const STATION_BY_KEY = Object.fromEntries(STATIONS.map((s) => [s.key, s])) as Record<
  StageKey,
  (typeof STATIONS)[number]
>;
