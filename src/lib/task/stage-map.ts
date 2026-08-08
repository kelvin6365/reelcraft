import type { StageKey } from "@/lib/next-action";

export const TASK_TYPE_TO_STAGE: Record<string, StageKey> = {
  REWRITE_SCRIPT: "script",
  SCRIPT_REVIEW: "script",
  EXTRACT_ASSETS: "assets",
  EXTRACT_PROPS: "assets",
  IMAGE_CHARACTER: "assets",
  IMAGE_LOCATION: "assets",
  IMAGE_PROP: "assets",
  VIDEO_PROP: "assets",
  BUILD_SCENES: "storyboard",
  STORYBOARD_RUN: "storyboard",
  SRT_BUILD: "storyboard",
  IMAGE_SHOT: "images",
  VIDEO_SHOT: "videos",
  VOICE_ANALYZE: "voice",
  VOICE_CAST: "voice",
  TTS_LINE: "voice",
  COMPOSE_EPISODE: "export",
};

export function countByStage(taskTypes: string[]): Partial<Record<StageKey, number>> {
  const out: Partial<Record<StageKey, number>> = {};
  for (const type of taskTypes) {
    const stage = TASK_TYPE_TO_STAGE[type];
    if (stage) out[stage] = (out[stage] ?? 0) + 1;
  }
  return out;
}
