// Registers all pipeline handlers (imported for side effects by the worker entry).
import { registerHandler } from "@/lib/workers/registry";
import { TASK_TYPE, TaskError } from "@/lib/task/types";
import {
  buildScenesHandler,
  extractAssetsHandler,
  rewriteScriptHandler,
  storyboardRunHandler,
  voiceAnalyzeHandler,
} from "@/lib/workers/handlers/text-handlers";
import {
  composeEpisodeHandler,
  imageCharacterHandler,
  imageLocationHandler,
  imageShotHandler,
  ttsLineHandler,
  videoShotHandler,
} from "@/lib/workers/handlers/media-handlers";

registerHandler(TASK_TYPE.REWRITE_SCRIPT, rewriteScriptHandler);
registerHandler(TASK_TYPE.EXTRACT_ASSETS, extractAssetsHandler);
registerHandler(TASK_TYPE.BUILD_SCENES, buildScenesHandler);
registerHandler(TASK_TYPE.STORYBOARD_RUN, storyboardRunHandler);
registerHandler(TASK_TYPE.VOICE_ANALYZE, voiceAnalyzeHandler);
registerHandler(TASK_TYPE.IMAGE_CHARACTER, imageCharacterHandler);
registerHandler(TASK_TYPE.IMAGE_LOCATION, imageLocationHandler);
registerHandler(TASK_TYPE.IMAGE_SHOT, imageShotHandler);
registerHandler(TASK_TYPE.VIDEO_SHOT, videoShotHandler);
registerHandler(TASK_TYPE.TTS_LINE, ttsLineHandler);
registerHandler(TASK_TYPE.COMPOSE_EPISODE, composeEpisodeHandler);

// EPISODE_SPLIT is an M2 feature (SRT/long-text flows); fail loudly if submitted.
registerHandler(TASK_TYPE.EPISODE_SPLIT, async () => {
  throw new TaskError("NOT_IMPLEMENTED", "EPISODE_SPLIT lands in M2", false);
});
