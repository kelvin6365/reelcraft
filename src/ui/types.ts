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
  // Optional predicted spend for the next 一鍵執行 click, e.g. for the images/
  // videos stages (see EpisodeView.cost.downstream). Absent = don't show a hint.
  estCostUsd?: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  stylePackId: string;
  videoRatio: string;
  videoResolution?: string;
  inputType?: string;
  episodes: { id: string; episodeNumber: number; status: string; updatedAt?: string }[];
}

export interface EpisodeListItem {
  id: string;
  episodeNumber: number;
  status: string;
  updatedAt?: string;
  // Batch/season generation (GET /api/projects/:id): autorun flag + failed-task
  // count for the season progress board.
  autorun?: boolean;
  failedTasks?: number;
}

// ---------- episode planning (docs/plans/2026-07-19-episode-planning-design.md) ----------
export type RiskLevel = "ok" | "review" | "problem";
export type RiskFlag =
  | "weak_hook"
  | "too_long"
  | "too_short"
  | "low_density"
  | "mid_scene_cut"
  | "dialogue_overflow";

export interface EpisodeRisk {
  level: RiskLevel;
  flags: RiskFlag[];
  note: string;
}

export interface PlannedEpisode {
  index: number;
  title: string;
  summary: string;
  startAnchor: string;
  endAnchor: string;
  hook: string;
  risk: EpisodeRisk;
}

export type PlanStatus = "none" | "planning" | "planned";

export interface PlanConfigView {
  anchor: "length" | "count";
  seconds?: number;
  count?: number;
  hookStrength: "normal" | "strong";
}

export interface PlanRisk {
  total: number;
  problem: number;
  review: number;
  ok: number;
}

// Per-project default model keys (provider::modelId). Prisma Json column.
export interface ModelDefaults {
  text?: string;
  image?: string;
  video?: string;
  tts?: string;
}

// GET /api/projects/:id — extends ProjectSummary with the planning fields.
export interface ProjectPlanView extends ProjectSummary {
  sourceText: string;
  modelDefaults: ModelDefaults | null;
  planStatus: PlanStatus;
  planConfig: PlanConfigView | null;
  planResult: { episodes: PlannedEpisode[] } | null;
  planRisk: PlanRisk | null;
  episodes: EpisodeListItem[];
}

// PATCH /api/projects/:id/plan → { episodes, risk }
export interface PlanEditResult {
  episodes: PlannedEpisode[];
  risk: PlanRisk;
}

export interface CharacterView {
  id: string;
  name: string;
  profile: string;
  appearancePrompt: string;
  candidates: string[]; // media ids
  lockedImageMediaId: string | null;
  lockedImageUrl: string | null;
  faceImageUrl?: string | null; // 近臉特寫 — auto-generated after lock
  locked: boolean;
  activeTask?: ActiveTaskView | null; // in-flight IMAGE_CHARACTER (reload survival)
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
  activeTask?: ActiveTaskView | null; // in-flight IMAGE_LOCATION (reload survival)
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
  // in-flight task on this shot at view-build time (null when idle) — the live
  // SSE stream takes over for updates after initial load
  activeImageTask: ActiveTaskView | null;
  activeVideoTask: ActiveTaskView | null;
}

export interface ActiveTaskView {
  taskId: string;
  status: string; // queued | processing
  progress: number;
}

// 劇本體檢 (S3) — Episode.scriptReview JSON shape
export interface ScriptRiskView {
  level: "ok" | "review" | "problem";
  flags: string[];
  note: string;
}
export interface ScriptReviewView {
  scenes: { index: number; label: string; risk: ScriptRiskView }[];
  overall: ScriptRiskView;
}

export interface VoiceLineView {
  id: string;
  lineIndex: number;
  speaker: string;
  content: string;
  lineType?: string; // 'dialogue' | 'vo' | 'os'
  cue?: string; // 括號演技/語氣提示
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
    scriptReview?: ScriptReviewView | Record<string, never>;
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
  cost?: {
    projectSpendUsd: number;
    downstream: {
      pendingImages: number;
      pendingVideos: number;
      estImageUsd: number;
      estVideoUsd: number;
      totalUsd: number;
      videoUnitUsd: number | null;
    } | null;
    // The model each of the two generation stations will actually use right
    // now (resolved system/user/project defaults) + its per-unit price, for
    // the station header chips. null when the downstream estimate itself
    // failed (e.g. episode not found — should not normally happen here).
    activeModels?: {
      image: { modelKey: string; unitUsd: number | null };
      video: { modelKey: string; unitUsd: number | null; perSecond: number | null };
    } | null;
  };
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

// GET /api/projects/:id/failed-tasks — project-wide failure overview, one row
// per failed task, with the owning episode's number attached for grouping.
export interface ProjectFailedTask extends FailedTask {
  episodeId: string | null;
  episodeNumber: number | null;
}

// POST /api/tasks/retry-bulk
export interface BulkRetryResult {
  id: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

export interface BulkRetryResponse {
  retried: number;
  total: number;
  results: BulkRetryResult[];
}

// SSE event payload (see /api/sse route).
export interface SseEvent {
  taskId: string;
  taskType: string;
  eventType: string; // CREATED | PROCESSING | PROGRESS | COMPLETED | FAILED | RETRYING | ...
  targetType?: string;
  targetId?: string;
  progress?: number;
  errorCode?: string | null;
}

// live per-target task state derived from SSE, keyed `${taskType}:${targetId}`
export type LiveTaskMap = Record<string, { progress?: number }>;

// ---------- usage dashboard (GET /api/usage) ----------
export interface UsageRowView {
  key: string;
  label: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
  uncostedCalls: number;
  providerCostUsd: number;
  providerCostedCalls: number;
  estCostOnProviderCostedUsd: number;
  actualCostUsd: number;
  errorCount: number;
  avgLatencyMs: number;
  quantityByUnit: Record<string, number>;
}

export interface UsageTotalsView {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
  uncostedCalls: number;
  providerCostUsd: number;
  providerCostedCalls: number;
  estCostOnProviderCostedUsd: number;
  actualCostUsd: number;
  errorCount: number;
  avgLatencyMs: number;
  errorRate: number;
}

export interface UsageResponse {
  rows: UsageRowView[];
  totals: UsageTotalsView;
  errorTop: { errorCode: string; count: number }[];
  range: { from: string; to: string; groupBy: string };
}

// ---------- settings: BYO provider keys (GET /api/user/provider-keys) ----------
export interface ProviderKeyView {
  provider: string;
  last4: string;
  updatedAt: string;
}

export interface ProviderKeysResponse {
  keys: ProviderKeyView[];
}

// ---------- settings: model defaults + catalog (GET /api/user/model-defaults, /api/models) ----------
export type ApiTypeKey = "text" | "image" | "video" | "tts";
export type DefaultsSource = "system" | "user" | "project";

// GET /api/user/model-defaults: the caller's stored slots, the fully-resolved
// effective models (+ which layer won each), and the system floor.
export interface UserModelDefaultsResponse {
  defaults: ModelDefaults;
  resolved: {
    text: string;
    image: string;
    video: string;
    tts: string;
    source: Record<ApiTypeKey, DefaultsSource>;
  };
  system: { text: string; image: string; video: string; tts: string };
}

export type ConnectionStatus = "user-key" | "env-key" | "none";

export interface ProviderView {
  id: string;
  label: string;
  connected: ConnectionStatus;
}

export type ModelUnitPrice =
  | { mode: "flat"; perUnit: number; unit: string }
  | { mode: "text"; inputPerMTok: number; outputPerMTok: number };

export interface ModelCatalogItem {
  modelKey: string;
  apiType: ApiTypeKey;
  provider: string;
  capabilities?: {
    durationsSec?: number[];
    resolutions?: string[];
    aspectRatios?: string[];
    modes?: string[];
  };
  unitPrice: ModelUnitPrice;
  recommend?: number; // 3 = top pick, 2 = solid, 1 = legacy
}

// GET /api/models — provider connection status + model catalog. generatedImageCount
// only present when ?projectId= was passed.
export interface ModelsResponse {
  providers: ProviderView[];
  models: ModelCatalogItem[];
  generatedImageCount?: number;
}

// GET /api/user/provider-readiness — onboarding guardrail (ProviderReadinessBanner).
// One entry per apiType slot in the caller's current resolved model defaults.
// PRESENCE only — never key material.
export interface ProviderReadinessItem {
  apiType: ApiTypeKey;
  apiTypeLabel: string;
  provider: string;
  providerLabel: string;
  modelKey: string;
  ready: boolean;
  source: "platform" | "user" | null;
}

export interface ProviderReadinessResponse {
  items: ProviderReadinessItem[];
  allReady: boolean;
}

// ---------- 進階模式 (advanced prompt mode) ----------
export type PromptSource = "system" | "user" | "project" | "oneoff";

// GET /api/user/preferences
export interface UserPreferences {
  advancedMode: boolean;
}

// GET /api/prompts?projectId= — one row per catalog prompt.
export interface PromptStatusView {
  promptId: string;
  description: string;
  version: string;
  variables: string[];
  source: PromptSource;
  hasUserOverride: boolean;
  hasProjectOverride: boolean;
  baseVersion?: string;
  drifted: boolean;
}

// GET /api/prompts/:promptId?projectId= — full editor payload.
export interface PromptOverrideView {
  content: string;
  baseVersion: string;
  baseContent: string;
  updatedAt: string;
}

export interface PromptDetailView extends PromptStatusView {
  system: string;
  user: PromptOverrideView | null;
  project: PromptOverrideView | null;
  effective: { content: string; source: PromptSource };
}

// GET /api/episodes/:id/last-prompt?promptId=
export interface LastPromptLog {
  at: string;
  modelKey: string;
  promptVersion: string | null;
  promptSource: PromptSource | null;
  renderedPrompt: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estCostUsd: number | null;
  status: string;
  errorCode: string | null;
}

export interface LastPromptResponse {
  log: LastPromptLog | null;
  // Always UNRENDERED — {變數} placeholders are literal, never fabricate a render.
  template: {
    content: string;
    source: PromptSource;
    version: string;
    baseVersion?: string;
    drifted: boolean;
  };
}

// POST /api/episodes/:id/prompt-rerun
export interface PromptRerunResponse {
  taskId: string;
}
