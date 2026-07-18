// Quota + rate-limit tests against a real Redis (localhost:6379). Env is seeded
// before the modules under test are dynamically imported, because @/lib/env
// validates process.env at import time. Small daily/limit values are chosen so the
// caps trip quickly. All keys use a per-run prefix and are cleaned up in afterAll.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL ||= "postgresql://reelcraft@localhost:5432/reelcraft";
process.env.REDIS_URL ||= "redis://localhost:6379";
process.env.STORAGE_ENDPOINT ||= "http://localhost:19000";
process.env.STORAGE_ACCESS_KEY ||= "test";
process.env.STORAGE_SECRET_KEY ||= "test";
process.env.STORAGE_BUCKET ||= "test";
process.env.BETTER_AUTH_SECRET ||= "test-secret";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
// Tiny daily cap so the trip case doesn't need 200 iterations.
process.env.QUOTA_DAILY_IMAGE = "3";
process.env.QUOTA_DAILY_VIDEO = "3";

type GateMod = typeof import("@/lib/quota/gate");
type DailyMod = typeof import("@/lib/quota/daily");
type RateMod = typeof import("@/lib/api/rate-limit");
type RedisMod = typeof import("@/lib/redis");

let gate: GateMod;
let daily: DailyMod;
let rate: RateMod;
let redis: RedisMod["redis"];

// Unique user id per test → isolated keys, no cross-test bleed.
const run = randomUUID().slice(0, 8);
const users: string[] = [];
function newUser(tag: string): string {
  const u = `qtest-${run}-${tag}-${users.length}`;
  users.push(u);
  return u;
}

beforeAll(async () => {
  gate = await import("@/lib/quota/gate");
  daily = await import("@/lib/quota/daily");
  rate = await import("@/lib/api/rate-limit");
  ({ redis } = await import("@/lib/redis"));
});

afterAll(async () => {
  const keys = await redis.keys(`*${run}*`);
  if (keys.length) await redis.del(...keys);
  await redis.quit();
});

describe("gate — distributed concurrency semaphore", () => {
  it("admits exactly `limit` under parallel contention", async () => {
    const user = newUser("parallel");
    const limit = 5;
    const results = await Promise.all(
      Array.from({ length: 20 }, () => gate.acquireSlot(user, "image", limit, 900)),
    );
    const granted = results.filter((t): t is string => t !== null);
    expect(granted).toHaveLength(limit);
    // The tokens are distinct and exactly `limit` live members remain.
    expect(new Set(granted).size).toBe(limit);
    expect(await redis.zcard(`rc:gate:image:${user}`)).toBe(limit);
  });

  it("releaseSlot frees a slot for the next acquirer", async () => {
    const user = newUser("release");
    const t1 = await gate.acquireSlot(user, "video", 1, 900);
    expect(t1).not.toBeNull();
    // Full now — second acquire is rejected.
    expect(await gate.acquireSlot(user, "video", 1, 900)).toBeNull();
    // Release the held slot, then acquire succeeds again.
    await gate.releaseSlot(user, "video", t1!);
    expect(await gate.acquireSlot(user, "video", 1, 900)).not.toBeNull();
  });

  it("reaps a stale slot older than the ttl on next acquire", async () => {
    const user = newUser("stale");
    const key = `rc:gate:image:${user}`;
    // Inject a slot whose score (acquire time) is well beyond the ttl window.
    const ttlSec = 60;
    const staleScore = Date.now() - ttlSec * 1000 - 5_000;
    await redis.zadd(key, staleScore.toString(), "dead-worker-token");
    expect(await redis.zcard(key)).toBe(1);

    // limit=1 would be full if the stale slot counted — it must be reaped first.
    const token = await gate.acquireSlot(user, "image", 1, ttlSec);
    expect(token).not.toBeNull();
    expect(await redis.zscore(key, "dead-worker-token")).toBeNull();
    expect(await redis.zcard(key)).toBe(1); // only the fresh slot remains
  });
});

describe("daily quota", () => {
  it("increments per call and trips QuotaExceededError over the cap", async () => {
    const user = newUser("daily");
    // QUOTA_DAILY_IMAGE=3 → first 3 pass, 4th throws.
    await daily.checkDailyQuota(user, "image");
    await daily.checkDailyQuota(user, "image");
    await daily.checkDailyQuota(user, "image");
    await expect(daily.checkDailyQuota(user, "image")).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
      status: 429,
    });
  });

  it("maps task types to the metered api class", () => {
    expect(daily.dailyApiTypeForTask("IMAGE_SHOT")).toBe("image");
    expect(daily.dailyApiTypeForTask("VIDEO_SHOT")).toBe("video");
    expect(daily.dailyApiTypeForTask("COMPOSE_EPISODE")).toBeNull();
    expect(daily.dailyApiTypeForTask("REWRITE_SCRIPT")).toBeNull();
  });
});

describe("api rate limit — sliding window, split buckets", () => {
  it("write bucket admits up to its cap then rejects within the window", async () => {
    const user = newUser("rate");
    const cap = Number(process.env.RATE_LIMIT_WRITE_MAX ?? 120);
    let admitted = 0;
    for (let i = 0; i < cap + 5; i++) {
      if (await rate.checkRateLimit(user, "write")) admitted++;
    }
    expect(admitted).toBe(cap);
    expect(await rate.checkRateLimit(user, "write")).toBe(false);
  });

  it("read and write buckets are independent", async () => {
    const user = newUser("rate");
    const writeCap = Number(process.env.RATE_LIMIT_WRITE_MAX ?? 120);
    for (let i = 0; i < writeCap; i++) await rate.checkRateLimit(user, "write");
    expect(await rate.checkRateLimit(user, "write")).toBe(false); // write exhausted
    expect(await rate.checkRateLimit(user, "read")).toBe(true); // reads unaffected
  });

  it("GET maps to read, mutations to write", () => {
    expect(rate.bucketForMethod("GET")).toBe("read");
    expect(rate.bucketForMethod("POST")).toBe("write");
    expect(rate.bucketForMethod("PATCH")).toBe("write");
    expect(rate.bucketForMethod("DELETE")).toBe("write");
  });
});
