// Deleting a shot / regenerating the storyboard must cancel that shot's in-flight
// image/video tasks so they don't run against a deleted row (spend → crash on
// "record not found"). This asserts the query shape: only active IMAGE_SHOT /
// VIDEO_SHOT tasks for the given shots are canceled.
import { beforeAll, describe, expect, it, vi } from "vitest";

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
  found: [] as { id: string; type: string; projectId: string }[],
  findWhere: null as unknown,
  updateWhere: null as unknown,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    task: {
      findMany: vi.fn(async (args: { where: unknown }) => {
        state.findWhere = args.where;
        return state.found;
      }),
      updateMany: vi.fn(async (args: { where: unknown }) => {
        state.updateWhere = args.where;
        return { count: state.found.length };
      }),
    },
  },
}));
vi.mock("@/lib/task/events", () => ({ publishTaskEvent: vi.fn() }));

type Mod = typeof import("@/lib/task/cancel-shot-tasks");
let M: Mod;
beforeAll(async () => {
  M = await import("@/lib/task/cancel-shot-tasks");
});

describe("cancelActiveShotTasks", () => {
  it("no-ops on an empty shot list without touching the db", async () => {
    state.found = [];
    state.findWhere = null;
    expect(await M.cancelActiveShotTasks("ep1", [])).toBe(0);
    expect(state.findWhere).toBeNull();
  });

  it("targets only active image/video tasks for the given shots in this episode", async () => {
    state.found = [{ id: "t1", type: "IMAGE_SHOT", projectId: "p1" }];
    await M.cancelActiveShotTasks("ep1", ["s1", "s2"]);
    const where = state.findWhere as Record<string, unknown>;
    expect(where.episodeId).toBe("ep1");
    expect(where.targetId).toEqual({ in: ["s1", "s2"] });
    expect(where.type).toEqual({ in: ["IMAGE_SHOT", "VIDEO_SHOT"] });
    expect(where.status).toEqual({ in: ["queued", "processing"] });
  });

  it("returns the number of tasks canceled", async () => {
    state.found = [
      { id: "t1", type: "IMAGE_SHOT", projectId: "p1" },
      { id: "t2", type: "VIDEO_SHOT", projectId: "p1" },
    ];
    expect(await M.cancelActiveShotTasks("ep1", ["s1"])).toBe(2);
  });
});
