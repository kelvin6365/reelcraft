// Per-user API rate limit — sliding window over a Redis sorted-set so it holds
// across every Next.js instance (not per-process). Wired into withAuth.
//
// Key: rc:ratelimit:{userId}   member = unique request id   score = timestamp(ms)
// Each check drops entries older than the window, counts what remains, and admits
// iff under the cap. Atomic via Lua so concurrent requests can't both slip through.
import { randomUUID } from "node:crypto";
import { redis } from "@/lib/redis";

export const RATE_LIMIT_MAX = 60; // requests
export const RATE_LIMIT_WINDOW_SEC = 60;

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

function rateLimitKey(userId: string): string {
  return `rc:ratelimit:${userId}`;
}

/** True when the request is allowed; false means the caller should return 429. */
export async function checkRateLimit(userId: string): Promise<boolean> {
  const windowMs = RATE_LIMIT_WINDOW_SEC * 1000;
  const allowed = await redis.eval(
    RATE_LIMIT_LUA,
    1,
    rateLimitKey(userId),
    Date.now().toString(),
    windowMs.toString(),
    RATE_LIMIT_MAX.toString(),
    randomUUID(),
  );
  return allowed === 1;
}
