// DEPLOY_MODE=local's DB poller (src/lib/task/local-queue.ts): claims `queued`
// tasks and dispatches them through processTask() — the same code path the
// BullMQ workers use. Mocks @/lib/db and @/lib/workers/processor so this stays
// a fast, DB-free unit test of the poller's own logic (claim/skip/concurrency).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://user:pw@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.STORAGE_ENDPOINT ??= "http://localhost:9000";
process.env.STORAGE_BUCKET ??= "test";
process.env.STORAGE_ACCESS_KEY ??= "test";
process.env.STORAGE_SECRET_KEY ??= "test";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.API_ENCRYPTION_KEY ??= "y".repeat(32);

interface FakeTask {
  id: string;
  type: string;
  status: string;
}

// processImpl lets each test control how long a "task" takes (e.g. never
// resolving, to pin inFlight for the concurrency-cap test).
const h = vi.hoisted(() => ({
  tasks: [] as FakeTask[],
  processCalls: [] as { queue: string; taskId: string }[],
  processImpl: (async () => {}) as (queue: string, taskId: string) => Promise<void>,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    task: {
      findMany: vi.fn(async ({ where }: { where: { status: string } }) =>
        h.tasks.filter((t) => t.status === where.status).map((t) => ({ id: t.id, type: t.type })),
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const t = h.tasks.find((x) => x.id === where.id);
        return t ? { status: t.status } : null;
      }),
    },
  },
}));

vi.mock("@/lib/workers/processor", () => ({
  processTask: vi.fn(async (queue: string, taskId: string) => {
    h.processCalls.push({ queue, taskId });
    return h.processImpl(queue, taskId);
  }),
}));

type Mod = typeof import("@/lib/task/local-queue");
let LQ: Mod;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  h.tasks = [];
  h.processCalls = [];
  h.processImpl = async () => {};
  LQ = await import("@/lib/task/local-queue");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startLocalWorker — poll loop", () => {
  it("claims a queued task on the first tick and dispatches it via processTask", async () => {
    h.tasks.push({ id: "t1", type: "IMAGE_SHOT", status: "queued" });
    LQ.startLocalWorker();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.processCalls).toEqual([{ queue: "rc-image", taskId: "t1" }]);
  });

  it("is idempotent — a second call does not start a second poll loop", async () => {
    const spy = vi.spyOn(global, "setInterval");
    LQ.startLocalWorker();
    LQ.startLocalWorker();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not pick up a task before the poller has started", async () => {
    h.tasks.push({ id: "t1", type: "IMAGE_SHOT", status: "queued" });
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.processCalls).toEqual([]);
  });
});

describe("concurrency cap", () => {
  it("never dispatches more than the in-flight cap at once", async () => {
    // processImpl never resolves — every claimed task stays in-flight forever,
    // so a second tick must not claim any more once the cap (4) is hit.
    h.processImpl = () => new Promise<void>(() => {});
    for (let i = 0; i < 8; i++) h.tasks.push({ id: `t${i}`, type: "IMAGE_SHOT", status: "queued" });

    LQ.startLocalWorker();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.processCalls).toHaveLength(4);

    await vi.advanceTimersByTimeAsync(2000);
    expect(h.processCalls).toHaveLength(4); // still capped — nothing new claimed
  });

  it("frees a slot once a task's processTask resolves, letting the next task in", async () => {
    let resolveFirst: (() => void) | undefined;
    let calls = 0;
    h.processImpl = () => {
      calls++;
      if (calls === 1) return new Promise<void>((resolve) => (resolveFirst = resolve));
      return Promise.resolve();
    };
    h.tasks.push({ id: "t1", type: "IMAGE_SHOT", status: "queued" });

    LQ.startLocalWorker();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.processCalls).toHaveLength(1);

    h.tasks.push({ id: "t2", type: "IMAGE_SHOT", status: "queued" });
    resolveFirst?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.processCalls.map((c) => c.taskId)).toContain("t2");
  });
});

describe("localDelays — retry backoff / gate requeue", () => {
  it("skips a task while its notBefore is in the future, then picks it up once it elapses", async () => {
    // Mirrors withTaskLifecycle claiming the row (status leaves 'queued') so a
    // later tick doesn't reselect it — isolates the notBefore behavior itself.
    h.processImpl = async (_queue, taskId) => {
      const t = h.tasks.find((x) => x.id === taskId);
      if (t) t.status = "processing";
    };
    h.tasks.push({ id: "t1", type: "IMAGE_SHOT", status: "queued" });
    LQ.localDelays.set("t1", Date.now() + 5000);

    LQ.startLocalWorker();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.processCalls).toEqual([]);

    await vi.advanceTimersByTimeAsync(5000);
    expect(h.processCalls).toEqual([{ queue: "rc-image", taskId: "t1" }]);
  });
});

describe("localJobAlive", () => {
  it("is false before the poller has started", async () => {
    expect(await LQ.localJobAlive("t1")).toBe(false);
  });

  it("is true for a task currently claimed (in-flight)", async () => {
    h.processImpl = () => new Promise<void>(() => {});
    h.tasks.push({ id: "t1", type: "IMAGE_SHOT", status: "queued" });
    LQ.startLocalWorker();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await LQ.localJobAlive("t1")).toBe(true);
  });

  it("falls back to the DB status once the poller is running: queued/processing = alive, terminal = not", async () => {
    h.tasks.push({ id: "t2", type: "IMAGE_SHOT", status: "queued" });
    LQ.startLocalWorker();
    expect(await LQ.localJobAlive("t2")).toBe(true);

    h.tasks[0].status = "completed";
    expect(await LQ.localJobAlive("t2")).toBe(false);
  });
});
