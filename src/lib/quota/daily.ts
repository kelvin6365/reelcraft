// Per-user daily spend caps for the expensive API classes (image / video).
// Counter: rc:daily:{yyyymmdd}:{userId}:{apiType}, INCR on submit, 48h TTL so
// yesterday's key self-cleans without a cron. Enforced in submitTask before enqueue.
import { redis } from "@/lib/redis";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/api/errors";
import { TASK_TYPE, type TaskType } from "@/lib/task/types";

export type DailyApiType = "image" | "video";

// Which task types burn a paid generation call that a daily cap should count.
// COMPOSE_EPISODE is local ffmpeg (no provider call) → not metered here.
export function dailyApiTypeForTask(type: TaskType): DailyApiType | null {
  switch (type) {
    case TASK_TYPE.IMAGE_CHARACTER:
    case TASK_TYPE.IMAGE_LOCATION:
    case TASK_TYPE.IMAGE_SHOT:
      return "image";
    case TASK_TYPE.VIDEO_SHOT:
      return "video";
    default:
      return null;
  }
}

// Extends ApiError so it surfaces through withAuth as a clean 429 QUOTA_EXCEEDED
// (rather than a generic 500) when thrown from submitTask inside an API route.
export class QuotaExceededError extends ApiError {
  constructor(
    public apiType: DailyApiType,
    public limit: number,
    public used: number,
  ) {
    super("QUOTA_EXCEEDED", 429, `daily ${apiType} quota exceeded (${used}/${limit})`);
    this.name = "QuotaExceededError";
  }
}

const TTL_SEC = 48 * 60 * 60;

function dayStamp(now = new Date()): string {
  // UTC yyyymmdd — quota windows are the same everywhere, no tz ambiguity.
  return now.toISOString().slice(0, 10).replace(/-/g, "");
}

function dailyKey(userId: string, apiType: DailyApiType, now?: Date): string {
  return `rc:daily:${dayStamp(now)}:${userId}:${apiType}`;
}

function limitFor(apiType: DailyApiType): number {
  return apiType === "video" ? env.QUOTA_DAILY_VIDEO : env.QUOTA_DAILY_IMAGE;
}

/**
 * Count one API call against today's budget and throw QuotaExceededError when the
 * user is over. INCR-then-check: the returned value is the post-increment count, so
 * the caller that trips the limit is the one rejected.
 */
export async function checkDailyQuota(userId: string, apiType: DailyApiType): Promise<void> {
  const key = dailyKey(userId, apiType);
  const used = await redis.incr(key);
  if (used === 1) await redis.expire(key, TTL_SEC);

  const limit = limitFor(apiType);
  if (used > limit) throw new QuotaExceededError(apiType, limit, used);
}
