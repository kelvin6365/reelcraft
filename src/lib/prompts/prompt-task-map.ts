// Static catalog-promptId → {taskType, stage, scope} map. Used by the (later
// slice) prompt-sheet UI to know which task type to re-submit and which
// pipeline stage a prompt belongs to. Exhaustiveness against the real catalog
// is asserted by tests/prompt-task-map.test.ts.
import { TASK_TYPE, type TaskType } from "@/lib/task/types";
import type { StageKey } from "@/lib/next-action";

export type PromptScopeKind = "episode" | "project" | "shot";

export interface PromptTaskEntry {
  taskType: TaskType;
  stage: StageKey;
  scope: PromptScopeKind;
}

export const PROMPT_TASK: Record<string, PromptTaskEntry> = {
  extract_assets: { taskType: TASK_TYPE.EXTRACT_ASSETS, stage: "assets", scope: "episode" },
  extract_props: { taskType: TASK_TYPE.EXTRACT_PROPS, stage: "assets", scope: "episode" },
  rewrite_script: { taskType: TASK_TYPE.REWRITE_SCRIPT, stage: "script", scope: "episode" },
  script_review: { taskType: TASK_TYPE.SCRIPT_REVIEW, stage: "script", scope: "episode" },
  build_scenes: { taskType: TASK_TYPE.BUILD_SCENES, stage: "storyboard", scope: "episode" },
  storyboard_plan: { taskType: TASK_TYPE.STORYBOARD_RUN, stage: "storyboard", scope: "episode" },
  storyboard_photography: { taskType: TASK_TYPE.STORYBOARD_RUN, stage: "storyboard", scope: "episode" },
  storyboard_acting: { taskType: TASK_TYPE.STORYBOARD_RUN, stage: "storyboard", scope: "episode" },
  storyboard_detail: { taskType: TASK_TYPE.STORYBOARD_RUN, stage: "storyboard", scope: "episode" },
  voice_analyze: { taskType: TASK_TYPE.VOICE_ANALYZE, stage: "voice", scope: "episode" },
  episode_split: { taskType: TASK_TYPE.EPISODE_SPLIT, stage: "input", scope: "project" },
  image_prompt_shot: { taskType: TASK_TYPE.IMAGE_SHOT, stage: "images", scope: "shot" },
};
