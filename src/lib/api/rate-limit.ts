// Per-user API rate limit — sliding window over a Redis sorted-set so it holds
// across every Next.js instance (not per-process). Wired into withAuth.
//
// Two buckets, because a page load fans out many cheap reads while the abuse we
// care about is expensive writes (task submission — themselves also gated by
// daily quota + concurrency + billing). GETs get a generous anti-runaway cap;
// mutations get a tighter one. Both are env-configurable.
//
// Key: rc:ratelimit:{read|write}:{userId}   member = unique id   score = ts(ms)
//
// DEPLOY_MODE=local substitutes an in-process sliding window (single process,
// so no distribution to worry about) — same admit/reject semantics, counters
// reset on restart.
import { randomUUID } from "node:crypto";
import { redis } from "@/lib/redis";
import { env, isLocalMode } from "@/lib/env";

export type RateBucket = "read" | "write";

const WINDOW_MS = env.RATE_LIMIT_WINDOW_SEC * 1000;
const MAX: Record<RateBucket, number> = {
  read: env.RATE_LIMIT_READ_MAX,
  write: env.RATE_LIMIT_WRITE_MAX,
};

// KEYS[1]=key ARGV[1]=now(ms) ARGV[2]=window(ms) ARGV[3]=max ARGV[4]=member
// Returns 1 when admitted, 0 when the window is full.
const RATE_LIMIT_LUA = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, tonumber(ARGV[1]) - tonumber(ARGV[2]))
if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[3]) then
  redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0
`;

export function bucketForMethod(method: string): RateBucket {
  return method === "GET" || method === "HEAD" ? "read" : "write";
}

const localWindows = new Map<string, number[]>(); // key -> ascending timestamps(ms)

function checkRateLimitLocal(userId: string, bucket: RateBucket): boolean {
  const key = `${bucket}:${userId}`;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  let hits = localWindows.get(key);
  if (!hits) {
    hits = [];
    localWindows.set(key, hits);
  }
  while (hits.length && hits[0] <= windowStart) hits.shift();
  if (hits.length >= MAX[bucket]) return false;
  hits.push(now);
  return true;
}

/** True when the request is allowed; false means the caller should return 429. */
export async function checkRateLimit(userId: string, bucket: RateBucket = "read"): Promise<boolean> {
  if (isLocalMode()) return checkRateLimitLocal(userId, bucket);

  const allowed = await redis.eval(
    RATE_LIMIT_LUA,
    1,
    `rc:ratelimit:${bucket}:${userId}`,
    Date.now().toString(),
    WINDOW_MS.toString(),
    MAX[bucket].toString(),
    randomUUID(),
  );
  return allowed === 1;
}
