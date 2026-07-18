// Task types + queue routing domain (docs/tech/02-task-system.md).

export const TASK_TYPE = {
  // text queue
  EPISODE_SPLIT: "EPISODE_SPLIT",
  EXTRACT_ASSETS: "EXTRACT_ASSETS",
  REWRITE_SCRIPT: "REWRITE_SCRIPT",
  BUILD_SCENES: "BUILD_SCENES",
  STORYBOARD_RUN: "STORYBOARD_RUN",
  SRT_BUILD: "SRT_BUILD",
  VOICE_ANALYZE: "VOICE_ANALYZE",
  // image queue
  IMAGE_CHARACTER: "IMAGE_CHARACTER",
  IMAGE_LOCATION: "IMAGE_LOCATION",
  IMAGE_SHOT: "IMAGE_SHOT",
  // video queue
  VIDEO_SHOT: "VIDEO_SHOT",
  COMPOSE_EPISODE: "COMPOSE_EPISODE",
  // voice queue
  TTS_LINE: "TTS_LINE",
  // dev/test only
  TEST_ECHO: "TEST_ECHO",
} as const;

export type TaskType = (typeof TASK_TYPE)[keyof typeof TASK_TYPE];

export type TaskStatus = "queued" | "processing" | "completed" | "failed" | "canceled";

export const ACTIVE_STATUSES: TaskStatus[] = ["queued", "processing"];

export type QueueName = "rc-text" | "rc-image" | "rc-video" | "rc-voice";

// Exhaustive routing — guard queue-route-exhaustive checks every TASK_TYPE is covered.
export function getQueueForTaskType(type: TaskType): QueueName {
  switch (type) {
    case TASK_TYPE.EPISODE_SPLIT:
    case TASK_TYPE.EXTRACT_ASSETS:
    case TASK_TYPE.REWRITE_SCRIPT:
    case TASK_TYPE.BUILD_SCENES:
    case TASK_TYPE.STORYBOARD_RUN:
    case TASK_TYPE.SRT_BUILD:
    case TASK_TYPE.VOICE_ANALYZE:
    case TASK_TYPE.TEST_ECHO:
      return "rc-text";
    case TASK_TYPE.IMAGE_CHARACTER:
    case TASK_TYPE.IMAGE_LOCATION:
    case TASK_TYPE.IMAGE_SHOT:
      return "rc-image";
    case TASK_TYPE.VIDEO_SHOT:
    case TASK_TYPE.COMPOSE_EPISODE:
      return "rc-video";
    case TASK_TYPE.TTS_LINE:
      return "rc-voice";
  }
}

export interface TaskJobData {
  taskId: string;
}

export class TaskError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable: boolean = false,
  ) {
    super(message);
    this.name = "TaskError";
  }
}

// App-layer retry classification (CLAUDE.md #6): retryable = transient infra/provider issues.
export function classifyError(err: unknown): { code: string; message: string; retryable: boolean } {
  if (err instanceof TaskError) return { code: err.code, message: err.message, retryable: err.retryable };
  if (err && typeof err === "object" && "code" in err && "retryable" in err) {
    const e = err as { code: string; message?: string; retryable: boolean };
    return { code: String(e.code), message: String(e.message ?? ""), retryable: Boolean(e.retryable) };
  }
  const msg = String(err instanceof Error ? err.message : err);
  const retryable = /ECONNRESET|ETIMEDOUT|ECONNREFUSED|fetch failed|socket hang up/i.test(msg);
  return { code: "UNKNOWN", message: msg, retryable };
}
