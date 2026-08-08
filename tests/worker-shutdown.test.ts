// 關機交還（releaseActiveTasks）—— worker 收 SIGTERM、drain 逾時之後，把手上
// 在途嘅 task 打返 queued 兼重新入 queue，令新 process 一開就接得返手，唔使等
// heartbeat timeout（90s）+ watchdog tick（30s）。
//
// 呢條路徑好難手測（要真係殺 worker），但寫錯代價好大：交還早過 worker.close()
// 就會有兩個 process 同時跑同一個 task。
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

const state = vi.hoisted(() => ({
  // taskId -> status；claim 同交還都靠佢
  tasks: new Map<string, string>(),
  updates: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    task: {
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        state.updates.push({ where, data });
        const id = where.id as string;
        const current = state.tasks.get(id);
        if (current === undefined) return { count: 0 };
        if (where.status !== undefined && current !== where.status) return { count: 0 }; // 狀態守衛
        if (typeof data.status === "string") state.tasks.set(id, data.status);
        return { count: 1 };
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        state.tasks.has(where.id) ? { id: where.id, type: "IMAGE_SHOT", projectId: "p1" } : null,
      ),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        type: "IMAGE_SHOT",
        targetType: "shot",
        targetId: "s1",
        projectId: "p1",
        episodeId: "e1",
        attempt: 1,
        maxAttempts: 3,
        userId: "u1",
        payload: {},
      })),
    },
  },
}));

const queued = vi.hoisted(() => ({ jobs: [] as { queue: string; taskId: string; delayMs: number }[] }));
vi.mock("@/lib/task/queues", () => ({
  addTaskJob: vi.fn(async (queue: string, taskId: string, delayMs = 0) => {
    queued.jobs.push({ queue, taskId, delayMs });
  }),
}));
const events = vi.hoisted(() => ({ published: [] as Record<string, unknown>[] }));
vi.mock("@/lib/task/events", () => ({
  publishTaskEvent: vi.fn((_p: unknown, ev: Record<string, unknown>) => void events.published.push(ev)),
}));
vi.mock("@/lib/billing/ledger", () => ({
  settleTaskFreeze: vi.fn(async () => {}),
  rollbackTaskFreeze: vi.fn(async () => {}),
}));
vi.mock("@/lib/ai/request-journal", () => ({ cancelPendingForTask: vi.fn(async () => 0) }));
vi.mock("@/lib/batch/advance", () => ({ advanceAfterTask: vi.fn() }));

const { withTaskLifecycle, releaseActiveTasks, getActiveTaskIds } = await import("@/lib/workers/lifecycle");

beforeEach(() => {
  state.tasks = new Map();
  state.updates = [];
  queued.jobs = [];
  events.published = [];
});

describe("releaseActiveTasks", () => {
  it("把在途 task 打返 queued 並重新入 queue", async () => {
    state.tasks.set("t1", "queued");

    // 開一個永遠唔完嘅 handler，模擬「跑到一半就收到 SIGTERM」
    let finish: () => void = () => {};
    const running = withTaskLifecycle("t1", () => new Promise<void>((r) => (finish = r)));
    await vi.waitFor(() => expect(getActiveTaskIds()).toEqual(["t1"]));
    expect(state.tasks.get("t1")).toBe("processing");

    expect(await releaseActiveTasks()).toBe(1);

    expect(state.tasks.get("t1")).toBe("queued");
    expect(queued.jobs).toEqual([{ queue: "rc-image", taskId: "t1", delayMs: 1 }]);
    expect(events.published.at(-1)).toMatchObject({ taskId: "t1", eventType: "RETRYING", errorCode: "WORKER_SHUTDOWN" });

    finish();
    await running;
  });

  it("狀態守衛：task 已經唔係 processing 就唔會被拉返去 queued", async () => {
    state.tasks.set("t1", "queued");
    let finish: () => void = () => {};
    const running = withTaskLifecycle("t1", () => new Promise<void>((r) => (finish = r)));
    await vi.waitFor(() => expect(getActiveTaskIds()).toEqual(["t1"]));

    // 例如用戶中途取消咗
    state.tasks.set("t1", "canceled");

    expect(await releaseActiveTasks()).toBe(0);
    expect(state.tasks.get("t1")).toBe("canceled");
    expect(queued.jobs).toHaveLength(0);

    finish();
    await running;
  });

  it("handler 做完之後就唔再係在途 task —— 交還唔會掂到佢", async () => {
    state.tasks.set("t1", "queued");
    await withTaskLifecycle("t1", async () => ({ ok: true }));

    expect(getActiveTaskIds()).toEqual([]);
    expect(state.tasks.get("t1")).toBe("completed");
    expect(await releaseActiveTasks()).toBe(0);
    expect(queued.jobs).toHaveLength(0);
  });
});
