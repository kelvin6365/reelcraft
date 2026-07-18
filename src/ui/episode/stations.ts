import type { StageKey } from "@/ui/types";

// The eight guided stations, in order. `dom` is the anchor id for scroll-to.
export const STATIONS: { key: StageKey; index: number; name: string; dom: string }[] = [
  { key: "input", index: 1, name: "原文", dom: "station-input" },
  { key: "assets", index: 2, name: "資產", dom: "station-assets" },
  { key: "script", index: 3, name: "劇本", dom: "station-script" },
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

export function scrollToStation(key: StageKey) {
  document.getElementById(STATION_BY_KEY[key].dom)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
