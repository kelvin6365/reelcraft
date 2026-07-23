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
  lastWhere: null as unknown,
  shots: [] as { id: string }[],
  submitted: [] as { type: string; targetId?: string; dedupeActive?: boolean }[],
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    shot: {
      findMany: vi.fn(async (args: { where: unknown }) => {
        state.lastWhere = args.where;
        return state.shots;
      }),
    },
  },
}));
vi.mock("@/lib/task/submit", () => ({
  submitTask: vi.fn(async (input: { type: string; targetId?: string; dedupeActive?: boolean }) => {
    state.submitted.push(input);
    return { taskId: "t1", deduped: false };
  }),
}));

type Mod = typeof import("@/lib/api/shot-batch");
let M: Mod;
beforeAll(async () => {
  M = await import("@/lib/api/shot-batch");
});

const episode = { id: "ep1", projectId: "p1" };
const reset = (shots: { id: string }[]) => {
  state.shots = shots;
  state.submitted = [];
  state.lastWhere = null;
};

describe("parseShotIds", () => {
  it("returns null for an absent or empty list so the route keeps its pending-only default", () => {
    expect(M.parseShotIds(null)).toBeNull();
    expect(M.parseShotIds({})).toBeNull();
    expect(M.parseShotIds({ shotIds: [] })).toBeNull();
  });

  it("drops non-string junk rather than passing it to the query", () => {
    expect(M.parseShotIds({ shotIds: ["a", 1, null, "", "b"] })).toEqual(["a", "b"]);
  });
});

describe("submitShotMediaBatch", () => {
  it("targets only pending shots when nothing is selected", async () => {
    reset([{ id: "s1" }]);
    await M.submitShotMediaBatch({ userId: "u1", episode, media: "image", shotIds: null });
    expect(state.lastWhere).toMatchObject({ episodeId: "ep1", imageMediaId: null });
  });

  it("honours an explicit selection, so a shot that already has media can be regenerated", async () => {
    reset([{ id: "s1" }, { id: "s2" }]);
    await M.submitShotMediaBatch({ userId: "u1", episode, media: "image", shotIds: ["s1", "s2"] });
    const where = state.lastWhere as Record<string, unknown>;
    expect(where.id).toEqual({ in: ["s1", "s2"] });
    expect(where.imageMediaId).toBeUndefined();
    expect(state.submitted).toHaveLength(2);
  });

  it("always scopes to the episode, even with an explicit selection", async () => {
    reset([{ id: "s1" }]);
    await M.submitShotMediaBatch({ userId: "u1", episode, media: "image", shotIds: ["someone-elses-shot"] });
    expect((state.lastWhere as Record<string, unknown>).episodeId).toBe("ep1");
  });

  it("keeps the image precondition on videos even for an explicit selection", async () => {
    reset([{ id: "s1" }]);
    await M.submitShotMediaBatch({ userId: "u1", episode, media: "video", shotIds: ["s1"] });
    expect((state.lastWhere as Record<string, unknown>).imageMediaId).toEqual({ not: null });
  });

  it("reports how many of the selected shots were skipped", async () => {
    reset([{ id: "s1" }]);
    const res = await M.submitShotMediaBatch({ userId: "u1", episode, media: "video", shotIds: ["s1", "s2"] });
    expect(res).toEqual({ submitted: 1, skipped: 1 });
  });

  it("collapses onto an in-flight task instead of paying twice", async () => {
    reset([{ id: "s1" }]);
    await M.submitShotMediaBatch({ userId: "u1", episode, media: "image", shotIds: ["s1"] });
    expect(state.submitted[0].dedupeActive).toBe(true);
  });
});
