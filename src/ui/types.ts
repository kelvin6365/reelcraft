
export type StageKey = "input" | "assets" | "script" | "storyboard" | "images" | "videos" | "voice" | "export";

export type StageStatus = "done" | "review" | "blocked" | "todo";

export interface StageState {
  key: StageKey;
  done: boolean;
  count?: { done: number; total: number };
  status: StageStatus;
  blockedBy: string[];
}

export interface NextAction {
  stage: StageKey;
  label: string;
  endpoint: string | null;
  blockedBy: string[];
  busy: boolean;
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
  autorun?: boolean;
  failedTasks?: number;
}

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

export interface ModelDefaults {
  text?: string;
  image?: string;
  video?: string;
  tts?: string;
}

export interface ProjectPlanView extends ProjectSummary {
  sourceText: string;
  modelDefaults: ModelDefaults | null;
  planStatus: PlanStatus;
  planConfig: PlanConfigView | null;
  planResult: { episodes: PlannedEpisode[] } | null;
  planRisk: PlanRisk | null;
  episodes: EpisodeListItem[];
}

export interface PlanEditResult {
  episodes: PlannedEpisode[];
  risk: PlanRisk;
}

export interface CharacterView {
  id: string;
  name: string;
  profile: string;
  appearancePrompt: string;
  candidates: string[];
  lockedImageMediaId: string | null;
  lockedImageUrl: string | null;
  faceImageUrl?: string | null;
  // 墊臉 — user-uploaded reference face fed into candidate generation
  refFaceUrl: string | null;
  refFaceNote: string;
  locked: boolean;
  activeTask?: ActiveTaskView | null;
  // 側面/背面視角 — mediaId/url 要鎖定主圖之後先會有值
  views: { label: string; prompt: string; mediaId: string | null; url: string | null }[];
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
  activeTask?: ActiveTaskView | null;
  // AI 建議視角 (extract_locations) — mediaId/url 要到 PR3 先會有值；reason 係
  // AI 判斷依據，純文字唔係畫面描述
  angles: { label: string; prompt: string; mediaId: string | null; url: string | null; reason?: string }[];
}

export interface PropView {
  id: string;
  name: string;
  tier: "key" | "scene" | "effect" | string;
  summary: string;
  prompt: string;
  material: string;
  dimensions: string;
  physicalParams: string;
  candidates: string[];
  lockedImageMediaId: string | null;
  lockedImageUrl: string | null;
  locked: boolean;
  locationId: string | null;
  refVideoMediaId: string | null;
  refVideoUrl: string | null;
  activeTask?: ActiveTaskView | null;
  // 呢件道具最新一次生成 attempt 嘅失敗記錄（DB 查返嚟，唔靠 SSE）——最新一次係
  // completed 就係 null。撳「重試」just 重新提交 regenerate，唔係 retry-by-taskId。
  lastError: { code: string | null; message: string | null; humanized: string; failedAt: string | null } | null;
  // 多視圖（key tier 四視圖：正/反/側/細節特寫；effect tier 靜態關鍵幀；scene tier 通常 0-1 個）
  views: { label: string; prompt: string; mediaId: string | null; url: string | null }[];
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
  // 實際生成影片嘅時長（worker 探測寫入 MediaObject；舊資料可能 null）。
  // 時間軸用 videoDurationMs ?? durationMs 做鏡頭闊度。
  videoDurationMs: number | null;
  activeImageTask: ActiveTaskView | null;
  activeVideoTask: ActiveTaskView | null;
}

export interface ActiveTaskView {
  taskId: string;
  status: string;
  progress: number;
}

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
  characterId: string | null;
  lineType?: string;
  cue?: string;
  emotion: string;
  emotionStrength: number;
  audioMediaId: string | null;
  audioUrl: string | null;
  // 成片時間軸欄位：chip 屬邊個鏡（matchedShotId）、釘死位置（offsetMs，null = auto
  // 順序排）、實際音長（舊資料可能 null，前端 loadedmetadata 補底）
  matchedShotId: string | null;
  offsetMs: number | null;
  audioDurationMs: number | null;
  activeTask?: ActiveTaskView | null;
}

export interface EpisodeView {
  candidateUrlById: Record<string, string>;
  // Whether the project's resolved image model accepts reference images
  // (natively, or via the atlascloud text-to-image → edit swap) — gates the
  // 墊臉 upload affordance in the character card UI.
  imageRefSupported: boolean;
  episode: {
    id: string;
    projectId: string;
    episodeNumber: number;
    status: string;
    rawText: string;
    scriptText: string;
    scriptReview?: ScriptReviewView | Record<string, never>;
    exportUrl: string | null;
    autoAdvance: {
      enabled: boolean;
      mode: "batch" | "assisted" | null;
      moneyAuthorized: boolean;
    };
    project: { id: string; name: string; stylePackId: string; videoRatio: string };
  };
  characters: CharacterView[];
  locations: LocationView[];
  props: PropView[];
  shots: ShotView[];
  voiceLines: VoiceLineView[];
  stages: StageState[];
  nextAction: NextAction;
  failedTasks: number;
  failedByStage: Partial<Record<StageKey, number>>;
  // Active tasks stuck past ~60s with no heartbeat — worker down / queue consumer
  // dropped. Non-zero → offer the 重新排隊 recovery action.
  stuckTasks: number;
  cost?: {
    projectSpendUsd: number;
    episodeSpendUsd: number;
    downstream: {
      pendingImages: number;
      pendingVideos: number;
      estImageUsd: number;
      estVideoUsd: number;
      estVoiceUsd: number;
      totalUsd: number;
      videoUnitUsd: number | null;
    } | null;
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
  queuedAt: string;
  finishedAt: string | null;
}

export interface ProjectFailedTask extends FailedTask {
  episodeId: string | null;
  episodeNumber: number | null;
}

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

export interface SseEvent {
  taskId: string;
  taskType: string;
  eventType: string;
  targetType?: string;
  targetId?: string;
  progress?: number;
  errorCode?: string | null;
}

export type LiveTaskMap = Record<string, { progress?: number }>;

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

export interface ProviderKeyView {
  provider: string;
  last4: string;
  updatedAt: string;
}

export interface ProviderKeysResponse {
  keys: ProviderKeyView[];
}

export type ApiTypeKey = "text" | "image" | "video" | "tts";
export type DefaultsSource = "system" | "user" | "project";

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
    supportsReferenceImages?: boolean;
  };
  unitPrice: ModelUnitPrice;
  recommend?: number;
}

export interface ModelsResponse {
  providers: ProviderView[];
  models: ModelCatalogItem[];
  generatedImageCount?: number;
}

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

export type PromptSource = "system" | "user" | "project" | "oneoff";

export interface UserPreferences {
  advancedMode: boolean;
}

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
  template: {
    content: string;
    source: PromptSource;
    version: string;
    baseVersion?: string;
    drifted: boolean;
  };
}

export interface PromptRerunResponse {
  taskId: string;
}
