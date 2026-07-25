// DEPLOY_MODE=local wiring, verified without a real Postgres/Redis:
//   - task/queues.ts's addTaskJob/isJobAlive never touch BullMQ or Redis
//   - task/events.ts's in-process bus delivers publishTaskEvent to subscribers
//   - quota/gate.ts's in-memory semaphore round-trips acquire/release
// Env is seeded before dynamic import (env.ts validates process.env at import
// time), mirroring tests/queues-jobmap.test.ts and tests/quota.test.ts.
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
process.env.DEPLOY_MODE = "local";

const h = vi.hoisted(() => ({
  queueAdd: vi.fn(async (..._args: unknown[]) => ({ id: "job" })),
  redisSet: vi.fn(async () => "OK"),
  redisGet: vi.fn(async () => null as string | null),
  redisPublish: vi.fn(async () => 0),
  taskEventRows: [] as { id: bigint; taskId: string; eventType: string; payload: object }[],
}));

vi.mock("bullmq", () => ({
  Queue: class {
    add(...args: unknown[]) {
      return h.queueAdd(...args);
    }
  },
}));

vi.mock("@/lib/redis", () => ({
  queueRedis: { set: h.redisSet, get: h.redisGet },
  redis: { publish: h.redisPublish },
  createSubscriber: vi.fn(),
  projectChannel: (id: string) => `rc:events:${id}`,
}));

// local-queue.ts's poller is exercised in tests/local-queue.test.ts — stub it
// here so queues.ts's import graph stays light for this plumbing-focused test.
vi.mock("@/lib/workers/processor", () => ({ processTask: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: {
    taskEvent: {
      create: vi.fn(async ({ data }: { data: { taskId: string; eventType: string; payload: object } }) => {
        const row = { id: BigInt(h.taskEventRows.length + 1), ...data };
        h.taskEventRows.push(row);
        return row;
      }),
    },
  },
}));

beforeEach(() => {
  vi.resetModules();
  h.queueAdd.mockClear();
  h.redisSet.mockClear();
  h.redisGet.mockClear();
  h.redisPublish.mockClear();
  h.taskEventRows = [];
});

describe("addTaskJob / isJobAlive — local mode never touches BullMQ or Redis", () => {
  it("addTaskJob with a delay records it locally instead of enqueueing a BullMQ job", async () => {
    const Q = await import("@/lib/task/queues");
    await Q.addTaskJob("rc-image", "task1", 5000);
    expect(h.queueAdd).not.toHaveBeenCalled();
    expect(h.redisSet).not.toHaveBeenCalled();
  });

  it("addTaskJob with no delay is a no-op — the task row is already queued for the poller", async () => {
    const Q = await import("@/lib/task/queues");
    await Q.addTaskJob("rc-image", "task1");
    expect(h.queueAdd).not.toHaveBeenCalled();
    expect(h.redisGet).not.toHaveBeenCalled();
  });

  it("isJobAlive delegates to the local driver, never calling BullMQ getJob", async () => {
    const Q = await import("@/lib/task/queues");
    // The poller hasn't started in this test, so localJobAlive is unconditionally false —
    // the point being asserted is that it resolves at all without touching Redis/BullMQ.
    expect(await Q.isJobAlive("rc-image", "task1")).toBe(false);
    expect(h.redisGet).not.toHaveBeenCalled();
  });
});

describe("task/events.ts — in-process bus in local mode", () => {
  it("publishTaskEvent delivers to a live subscriber without touching Redis pub/sub", async () => {
    const E = await import("@/lib/task/events");
    const received: string[] = [];
    const sub = await E.subscribeProjectEvents("proj1", (msg) => received.push(msg));

    E.publishTaskEvent("proj1", { taskId: "t1", taskType: "IMAGE_SHOT", eventType: "PROCESSING" });
    await vi.waitFor(() => expect(received).toHaveLength(1));

    expect(h.redisPublish).not.toHaveBeenCalled();
    const parsed = JSON.parse(received[0]);
    expect(parsed).toMatchObject({ taskId: "t1", taskType: "IMAGE_SHOT", eventType: "PROCESSING" });

    sub.close();
  });

  it("subscribers on a different project don't receive the event", async () => {
    const E = await import("@/lib/task/events");
    const received: string[] = [];
    const sub = await E.subscribeProjectEvents("proj-a", (msg) => received.push(msg));

    E.publishTaskEvent("proj-b", { taskId: "t2", taskType: "IMAGE_SHOT", eventType: "PROCESSING" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(received).toHaveLength(0);
    sub.close();
  });

  it("close() is idempotent and stops further delivery", async () => {
    const E = await import("@/lib/task/events");
    const received: string[] = [];
    const sub = await E.subscribeProjectEvents("proj1", (msg) => received.push(msg));
    sub.close();
    sub.close(); // must not throw

    E.publishTaskEvent("proj1", { taskId: "t3", taskType: "IMAGE_SHOT", eventType: "PROCESSING" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(received).toHaveLength(0);
  });
});

describe("quota/gate.ts — in-memory semaphore in local mode", () => {
  it("acquireSlot/releaseSlot round-trip without Redis", async () => {
    const gate = await import("@/lib/quota/gate");
    const token = await gate.acquireSlot("u1", "image", 1, 900);
    expect(token).not.toBeNull();
    expect(await gate.acquireSlot("u1", "image", 1, 900)).toBeNull(); // at the limit

    await gate.releaseSlot("u1", "image", token!);
    expect(await gate.acquireSlot("u1", "image", 1, 900)).not.toBeNull(); // freed
  });

  it("reapStaleSlots frees slots older than the given age without touching Redis", async () => {
    const gate = await import("@/lib/quota/gate");
    const token = await gate.acquireSlot("u2", "video", 1, 900);
    expect(token).not.toBeNull();

    expect(await gate.reapStaleSlots("u2", "video", 10_000)).toBe(0); // fresh — not old enough yet
    const reaped = await gate.reapStaleSlots("u2", "video", -1); // "older than -1ms" == everything
    expect(reaped).toBe(1);
    expect(await gate.acquireSlot("u2", "video", 1, 900)).not.toBeNull(); // slot is free again
  });
});
