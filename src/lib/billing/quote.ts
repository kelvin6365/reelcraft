// Pre-flight cost quote for a task — the amount we reserve before work starts.
// A quote is a worst-case estimate priced from standards/capabilities.json (the
// only legal price source); settleFreeze later reconciles to the actual cost
// from ai_call_logs and refunds the difference, so over-reserving is safe.
import { prisma } from "@/lib/db";
import { getCapabilityEntry } from "@/lib/ai/capabilities";
import { resolveModelDefaults } from "@/lib/model-defaults/resolve";
import { TASK_TYPE, type TaskType } from "@/lib/task/types";

// Text tasks price per-token at run time; we can't know token counts up front,
// so reserve a flat ceiling per text task.
const TEXT_FLAT_QUOTE_USD = 0.05;
// Asset image tasks (character/location) generate a fixed set of candidates —
// mirror CANDIDATE_COUNT in media-handlers.
const ASSET_CANDIDATE_COUNT = 3;
// Video duration isn't fixed at submit time; reserve the model's longest clip.
const FALLBACK_VIDEO_SEC = 10;
// TTS text lives on the VoiceLine row, not the payload; reserve a generous
// default when the caller doesn't hint a length.
const DEFAULT_TTS_CHARS = 500;

type Payload = Record<string, unknown>;

interface ProjectModels {
  image: string;
  video: string;
  tts: string;
}

// Resolve through the shared three-layer resolver — same models the worker will
// actually run — so a quote prices real system defaults even when the project
// set no overrides (design doc: empty-defaults projects are no longer $0/fake).
async function resolveModels(userId: string, projectId: string | undefined): Promise<ProjectModels> {
  const project = projectId
    ? await prisma.project.findUnique({ where: { id: projectId }, select: { modelDefaults: true } })
    : null;
  const r = await resolveModelDefaults(userId, project);
  return { image: r.image, video: r.video, tts: r.tts };
}

function flatUnitPrice(modelKey: string, unit: "image" | "second" | "character"): number {
  const pricing = getCapabilityEntry(modelKey)?.pricing;
  return pricing?.mode === "flat" && pricing.unit === unit ? pricing.perUnit : 0;
}

function worstVideoSeconds(modelKey: string): number {
  const durations = getCapabilityEntry(modelKey)?.capabilities?.durationsSec;
  return durations?.length ? Math.max(...durations) : FALLBACK_VIDEO_SEC;
}

function ttsCharCount(payload: Payload): number {
  const hint = payload.charCount ?? payload.textLength;
  if (typeof hint === "number" && hint > 0) return hint;
  const text = payload.text ?? payload.content;
  if (typeof text === "string" && text.length > 0) return text.length;
  return DEFAULT_TTS_CHARS;
}

// Worst-case USD to reserve for one task. Falls to $0 for fake/free providers,
// which is correct — those tasks cost nothing. Prices the models the resolver
// picks for this user+project, so needs userId (design doc: quote == run).
export async function estimateTaskCost(
  type: TaskType,
  userId: string,
  payload: Payload = {},
  projectId?: string,
): Promise<number> {
  const models = await resolveModels(userId, projectId);

  switch (type) {
    case TASK_TYPE.IMAGE_CHARACTER:
    case TASK_TYPE.IMAGE_LOCATION:
      return flatUnitPrice(models.image, "image") * ASSET_CANDIDATE_COUNT;
    case TASK_TYPE.IMAGE_SHOT:
      return flatUnitPrice(models.image, "image");
    case TASK_TYPE.VIDEO_SHOT:
      return flatUnitPrice(models.video, "second") * worstVideoSeconds(models.video);
    case TASK_TYPE.TTS_LINE:
      return flatUnitPrice(models.tts, "character") * ttsCharCount(payload);
    case TASK_TYPE.COMPOSE_EPISODE:
    case TASK_TYPE.TEST_ECHO:
      return 0; // local ffmpeg / no provider spend
    default:
      return TEXT_FLAT_QUOTE_USD; // every text-queue task
  }
}
