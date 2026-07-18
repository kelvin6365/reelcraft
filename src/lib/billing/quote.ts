// Pre-flight cost quote for a task — the amount we reserve before work starts.
// A quote is a worst-case estimate priced from standards/capabilities.json (the
// only legal price source); settleFreeze later reconciles to the actual cost
// from ai_call_logs and refunds the difference, so over-reserving is safe.
import { prisma } from "@/lib/db";
import { getCapabilityEntry } from "@/lib/ai/capabilities";
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
  image: string | null;
  video: string | null;
  tts: string | null;
}

async function resolveModels(projectId: string | undefined): Promise<ProjectModels> {
  if (!projectId) return { image: null, video: null, tts: null };
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { modelDefaults: true },
  });
  const d = (project?.modelDefaults ?? {}) as { image?: string; video?: string; tts?: string };
  return { image: d.image ?? null, video: d.video ?? null, tts: d.tts ?? null };
}

function flatUnitPrice(modelKey: string | null, unit: "image" | "second" | "character"): number {
  if (!modelKey) return 0;
  const pricing = getCapabilityEntry(modelKey)?.pricing;
  return pricing?.mode === "flat" && pricing.unit === unit ? pricing.perUnit : 0;
}

function worstVideoSeconds(modelKey: string | null): number {
  const durations = modelKey ? getCapabilityEntry(modelKey)?.capabilities?.durationsSec : undefined;
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
// which is correct — those tasks cost nothing.
export async function estimateTaskCost(
  type: TaskType,
  payload: Payload = {},
  projectId?: string,
): Promise<number> {
  const models = await resolveModels(projectId);

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
