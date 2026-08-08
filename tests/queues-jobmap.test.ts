// Re-enqueued tasks get a suffixed BullMQ jobId, so isJobAlive must look the
// current jobId up (via the Redis map addTaskJob writes) instead of the bare
// taskId — otherwise the watchdog/recover keep re-adding jobs that are actually
// alive, piling up thousands of delayed duplicates.
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://user:pw@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.STORAGE_ENDPOINT ??= "http://localhost:9000";
process.env.STORAGE_BUCKET ??= "test";
process.env.STORAGE_ACCESS_KEY ??= "test";
process.env.STORAGE_SECRET_KEY ??= "test";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.API_ENCRYPTION_KEY ??= "y".repeat(32);

// In-memory stand-ins for the BullMQ queue + Redis map.
const h = vi.hoisted(() => ({
  store: new Map<string, string>(), // jobmap key → jobId
  jobs: new Map<string, string>(), // jobId → state
  added: [] as { jobId: string; delay: number }[],
  getJobArg: null as string | null,
}));

vi.mock("@/lib/redis", () => ({
  queueRedis: {
    set: vi.fn(async (k: string, v: string) => void h.store.set(k, v)),
    get: vi.fn(async (k: string) => h.store.get(k) ?? null),
  },
}));
vi.mock("bullmq", () => ({
  Queue: class {
    async add(_name: string, _data: unknown, opts: { jobId: string; delay: number }) {
      h.added.push({ jobId: opts.jobId, delay: opts.delay });
      h.jobs.set(opts.jobId, opts.delay > 0 ? "delayed" : "waiting");
      return { id: opts.jobId };
    }
    async getJob(jobId: string) {
      h.getJobArg = jobId;
      const state = h.jobs.get(jobId);
      return state ? { getState: async () => state } : null;
    }
  },
}));

// 唔行 vi.resetModules()：呢個 module 冇 per-test 要清嘅內部 state —— 佢啲
// Queue instance 掛喺 globalThis（`__rcQueues`），resetModules 本來就清唔到，
// 真正要清嘅嘢全部喺上面個 `h` 度。而 resetModules 會令成個 module graph
// （env / local-queue / db …）逐個 test 重新 import，每次 ~2 秒；跑全套時
// 撞正機器忙就會衝爆 vitest 預設 5 秒 timeout，變成間歇性紅燈。
const Q = await import("@/lib/task/queues");

beforeEach(() => {
  h.store.clear();
  h.jobs.clear();
  h.added = [];
  h.getJobArg = null;
});

describe("addTaskJob jobId mapping", () => {
  it("initial enqueue keys the job by the bare taskId", async () => {
    await Q.addTaskJob("rc-image" as never, "task1");
    expect(h.added[0].jobId).toBe("task1");
    expect(h.store.get("rc:jobmap:task1")).toBe("task1");
  });

  it("re-enqueue uses a suffixed jobId and records it in the map", async () => {
    await Q.addTaskJob("rc-image" as never, "task1", 5000);
    const jid = h.added[0].jobId;
    expect(jid).toMatch(/^task1-r\d+$/);
    expect(h.store.get("rc:jobmap:task1")).toBe(jid);
  });
});

describe("isJobAlive follows the map", () => {
  it("looks up the suffixed job, not the bare taskId", async () => {
    await Q.addTaskJob("rc-image" as never, "task1", 5000);
    const jid = h.added[0].jobId;
    const alive = await Q.isJobAlive("rc-image" as never, "task1");
    expect(alive).toBe(true);
    expect(h.getJobArg).toBe(jid); // NOT "task1" — the bug was checking the bare id
  });

  it("falls back to the bare taskId when no map entry exists (legacy job)", async () => {
    h.jobs.set("legacyTask", "waiting"); // a job added before the map existed
    const alive = await Q.isJobAlive("rc-image" as never, "legacyTask");
    expect(alive).toBe(true);
    expect(h.getJobArg).toBe("legacyTask");
  });

  it("reports not-alive when the mapped job is gone (stale map → safe re-enqueue)", async () => {
    await h.store.set("rc:jobmap:task1", "task1-r999"); // points at a job that no longer exists
    expect(await Q.isJobAlive("rc-image" as never, "task1")).toBe(false);
  });

  it("reports not-alive for completed/failed states", async () => {
    await Q.addTaskJob("rc-image" as never, "task1", 5000);
    h.jobs.set(h.added[0].jobId, "completed");
    expect(await Q.isJobAlive("rc-image" as never, "task1")).toBe(false);
  });
});
