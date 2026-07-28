// Registers all pipeline handlers (imported for side effects by the worker entry).
import { registerHandler } from "@/lib/workers/registry";
import { TASK_TYPE } from "@/lib/task/types";
import { episodeSplitHandler } from "@/lib/workers/handlers/planning-handler";
import {
  buildScenesHandler,
  extractAssetsHandler,
  extractPropsHandler,
  rewriteScriptHandler,
  scriptReviewHandler,
  srtBuildHandler,
  storyboardRunHandler,
  voiceAnalyzeHandler,
} from "@/lib/workers/handlers/text-handlers";
import {
  composeEpisodeHandler,
  imageCharacterHandler,
  imageLocationHandler,
  imagePropHandler,
  imageShotHandler,
  propEffectVideoHandler,
  ttsLineHandler,
  videoShotHandler,
} from "@/lib/workers/handlers/media-handlers";

registerHandler(TASK_TYPE.REWRITE_SCRIPT, rewriteScriptHandler);
registerHandler(TASK_TYPE.SCRIPT_REVIEW, scriptReviewHandler);
registerHandler(TASK_TYPE.EXTRACT_ASSETS, extractAssetsHandler);
registerHandler(TASK_TYPE.EXTRACT_PROPS, extractPropsHandler);
registerHandler(TASK_TYPE.BUILD_SCENES, buildScenesHandler);
registerHandler(TASK_TYPE.STORYBOARD_RUN, storyboardRunHandler);
registerHandler(TASK_TYPE.SRT_BUILD, srtBuildHandler);
registerHandler(TASK_TYPE.VOICE_ANALYZE, voiceAnalyzeHandler);
registerHandler(TASK_TYPE.IMAGE_CHARACTER, imageCharacterHandler);
registerHandler(TASK_TYPE.IMAGE_LOCATION, imageLocationHandler);
registerHandler(TASK_TYPE.IMAGE_PROP, imagePropHandler);
registerHandler(TASK_TYPE.IMAGE_SHOT, imageShotHandler);
registerHandler(TASK_TYPE.VIDEO_SHOT, videoShotHandler);
registerHandler(TASK_TYPE.VIDEO_PROP, propEffectVideoHandler);
registerHandler(TASK_TYPE.TTS_LINE, ttsLineHandler);
registerHandler(TASK_TYPE.COMPOSE_EPISODE, composeEpisodeHandler);

registerHandler(TASK_TYPE.EPISODE_SPLIT, episodeSplitHandler);
