// UI-side mirrors of the API response shapes (GET /api/episodes/:id etc.).
// Kept intentionally loose where the server sends Prisma JSON columns.

export type StageKey = "input" | "assets" | "script" | "storyboard" | "images" | "videos" | "voice" | "export";

export interface StageState {
  key: StageKey;
  done: boolean;
  count?: { done: number; total: number };
}

export interface NextAction {
  stage: StageKey;
  label: string;
  endpoint: string | null;
  blockedBy: string[];
  busy: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  stylePackId: string;
  videoRatio: string;
  inputType?: string;
  episodes: { id: string; episodeNumber: number; status: string; updatedAt?: string }[];
}

export interface EpisodeListItem {
  id: string;
  episodeNumber: number;
  status: string;
  updatedAt?: string;
}

export interface CharacterView {
  id: string;
  name: string;
  profile: string;
  appearancePrompt: string;
  candidates: string[]; // media ids
  lockedImageMediaId: string | null;
  lockedImageUrl: string | null;
  locked: boolean;
}

export interface LocationView {
  id: string;
  name: string;
  summary: string;
  prompt: string;
  candidates: string[];
  lockedImageMediaId: string | null;
  lockedImageUrl: string | null;
  locked: boolean;
}

export interface StoryboardJson {
  plan?: { index: number; source_text?: string; subject?: string; beat?: string; dialogue?: string } | null;
  detail?: { index: number; shotSize?: string; angle?: string; camera?: string; note?: string } | null;
  photography?: unknown;
  acting?: unknown;
}

export interface ShotView {
  id: string;
  shotIndex: number;
  storyboardJson: StoryboardJson;
  imagePrompt: string;
  videoPrompt: string;
  imageMediaId: string | null;
  videoMediaId: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  status: string;
  durationMs: number;
}

export interface VoiceLineView {
  id: string;
  lineIndex: number;
  speaker: string;
  content: string;
  emotion: string;
  emotionStrength: number;
  audioMediaId: string | null;
  audioUrl: string | null;
}

export interface EpisodeView {
  candidateUrlById: Record<string, string>;
  episode: {
    id: string;
    projectId: string;
    episodeNumber: number;
    status: string;
    rawText: string;
    scriptText: string;
    exportUrl: string | null;
    project: { id: string; name: string; stylePackId: string; videoRatio: string };
  };
  characters: CharacterView[];
  locations: LocationView[];
  shots: ShotView[];
  voiceLines: VoiceLineView[];
  stages: StageState[];
  nextAction: NextAction;
  failedTasks: number;
}

export interface FailedTask {
  id: string;
  type: string;
  status: string;
  progress: number;
  attempt: number;
  errorCode: string | null;
  errorMessage: string | null;
  targetType: string | null;
  targetId: string | null;
}

// SSE event payload (see /api/sse route).
export interface SseEvent {
  taskId: string;
  taskType: string;
  eventType: string; // QUEUED | STARTED | PROGRESS | COMPLETED | FAILED | ...
  progress?: number;
}
