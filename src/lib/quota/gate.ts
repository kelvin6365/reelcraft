// Distributed concurrency semaphore per (userId, scope) — replaces the in-process
// gate that waoowaoo used (broken across multiple worker processes). State lives in
// a Redis sorted-set so every worker sees the same slot count.
//
// Key: rc:gate:{scope}:{userId}   member = opaque token   score = acquire time (ms)
// A slot older than ttlSec is treated as stale (crashed worker) and reaped on the
// next acquire — this is what keeps a dead worker from leaking a slot forever.
//
// DEPLOY_MODE=local runs a single process, so an in-process Map substitutes with
// the same acquire/release/reap semantics (state resets on restart — the local
// driver has no TTL persistence to lose, so that's expected, not a regression).
import { randomUUID } from "node:crypto";
import { redis } from "@/lib/redis";
import { isLocalMode } from "@/lib/env";

export type GateScope = "image" | "video";

function gateKey(scope: GateScope, userId: string): string {
  return `rc:gate:${scope}:${userId}`;
}

// Atomic acquire: reap stale members, then admit iff live count < limit.
// KEYS[1]=key  ARGV[1]=now(ms)  ARGV[2]=ttl(ms)  ARGV[3]=limit  ARGV[4]=token
// Returns the token on success, or nil when the semaphore is full.
const ACQUIRE_LUA = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, tonumber(ARGV[1]) - tonumber(ARGV[2]))
if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[3]) then
  redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return ARGV[4]
end
return nil
`;

// --- local-mode driver: same key shape, Map<token, acquireTimeMs> per (scope, userId) ---
const localGates = new Map<string, Map<string, number>>();

function localSlots(scope: GateScope, userId: string): Map<string, number> {
  const key = gateKey(scope, userId);
  let slots = localGates.get(key);
  if (!slots) {
    slots = new Map();
    localGates.set(key, slots);
  }
  return slots;
}

function reapExpiredLocal(slots: Map<string, number>, ttlMs: number): void {
  const cutoff = Date.now() - ttlMs;
  for (const [token, acquiredAt] of slots) {
    if (acquiredAt <= cutoff) slots.delete(token);
  }
}

/**
 * Try to take one concurrency slot. Returns an opaque token to pass to
 * releaseSlot, or null when the user is already at `limit` for this scope.
 */
export async function acquireSlot(
  userId: string,
  scope: GateScope,
  limit: number,
  ttlSec: number,
): Promise<string | null> {
  const token = randomUUID();

  if (isLocalMode()) {
    const slots = localSlots(scope, userId);
    reapExpiredLocal(slots, ttlSec * 1000);
    if (slots.size >= limit) return null;
    slots.set(token, Date.now());
    return token;
  }

  const ttlMs = ttlSec * 1000;
  const result = await redis.eval(
    ACQUIRE_LUA,
    1,
    gateKey(scope, userId),
    Date.now().toString(),
    ttlMs.toString(),
    limit.toString(),
    token,
  );
  return (result as string | null) ?? null;
}

/** Give back a slot taken by acquireSlot. Idempotent — a stale token is a no-op. */
export async function releaseSlot(userId: string, scope: GateScope, token: string): Promise<void> {
  if (isLocalMode()) {
    localSlots(scope, userId).delete(token);
    return;
  }
  await redis.zrem(gateKey(scope, userId), token);
}

// Force-reap slots older than `olderThanMs`. The Lua only reaps on the next
// acquire (bounded by the 15-min gate TTL), so a worker killed mid-job leaks its
// slots and starves that user's queue for up to 15 minutes — the "17 shots stuck
// 生成中 forever" symptom. The 重新排隊 recovery calls this with olderThanMs=0
// (reap all) ONLY after confirming the user has no processing task in the scope,
// so no genuinely-running job's slot is touched. Returns how many were reaped.
export async function reapStaleSlots(userId: string, scope: GateScope, olderThanMs: number): Promise<number> {
  if (isLocalMode()) {
    const slots = localSlots(scope, userId);
    const cutoff = Date.now() - olderThanMs;
    let reaped = 0;
    for (const [token, acquiredAt] of slots) {
      if (acquiredAt <= cutoff) {
        slots.delete(token);
        reaped++;
      }
    }
    return reaped;
  }
  return redis.zremrangebyscore(gateKey(scope, userId), 0, Date.now() - olderThanMs);
}
