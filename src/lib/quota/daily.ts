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
// INCR + EXPIRE-on-first atomically (a crash between the two would otherwise
// leak a TTL-less key). Returns the post-increment count.
const INCR_LUA = `
local v = redis.call('INCR', KEYS[1])
if v == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return v`;

export async function checkDailyQuota(userId: string, apiType: DailyApiType): Promise<void> {
  const key = dailyKey(userId, apiType);
  const used = (await redis.eval(INCR_LUA, 1, key, String(TTL_SEC))) as number;

  const limit = limitFor(apiType);
  if (used > limit) throw new QuotaExceededError(apiType, limit, used);
}

// Give back a counted slot when a submission is rejected BEFORE it ever ran
// (insufficient balance, enqueue failure) — those never touched a provider, so
// they shouldn't burn the user's daily cap. Floor at 0.
export async function refundDailyQuota(userId: string, type: TaskType): Promise<void> {
  const apiType = dailyApiTypeForTask(type);
  if (!apiType) return;
  const key = dailyKey(userId, apiType);
  const v = await redis.decr(key);
  if (v < 0) await redis.set(key, "0");
}
