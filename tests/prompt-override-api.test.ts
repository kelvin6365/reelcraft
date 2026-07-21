import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Slice 4a: /api/prompts CRUD. Route handlers themselves aren't unit-tested
// anywhere in this repo (no precedent), so this exercises the pure logic layer
// the routes are built on — src/lib/prompts/status.ts — using the same
// vi.hoisted mutable state box + vi.mock("@/lib/db") pattern as
// tests/prompt-resolve.test.ts, with the real catalog + real prompt files.
interface OverrideRow {
  userId: string;
  projectId: string;
  promptId: string;
  content: string;
  baseVersion: string;
  baseContent: string;
  updatedAt: Date;
}
const dbState = vi.hoisted(() => ({ rows: [] as OverrideRow[] }));
vi.mock("@/lib/db", () => ({
  prisma: {
    promptOverride: {
      findMany: vi.fn(
        async (args: { where: { userId: string; promptId?: string; projectId: { in: string[] } } }) => {
          const { userId, promptId, projectId } = args.where;
          return dbState.rows.filter(
            (r) =>
              r.userId === userId &&
              (promptId === undefined || r.promptId === promptId) &&
              projectId.in.includes(r.projectId),
          );
        },
      ),
    },
  },
}));

process.env.DATABASE_URL ??= "postgres://user:pw@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.STORAGE_ENDPOINT ??= "http://localhost:9000";
process.env.STORAGE_ACCESS_KEY ??= "test";
process.env.STORAGE_SECRET_KEY ??= "test";
process.env.STORAGE_BUCKET ??= "test";
process.env.BETTER_AUTH_SECRET ??= "test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.API_ENCRYPTION_KEY = "unit-test-encryption-key-0123456789";

type StatusMod = typeof import("@/lib/prompts/status");
type BuildMod = typeof import("@/lib/prompts/build-prompt");
let S: StatusMod;
let B: BuildMod;

const U = "user-1";
const OTHER_U = "user-2";

beforeAll(async () => {
  S = await import("@/lib/prompts/status");
  B = await import("@/lib/prompts/build-prompt");
});

beforeEach(() => {
  dbState.rows = [];
  B.clearPromptCache();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("listPromptStatuses", () => {
  it("lists every catalog prompt as source=system when there are no overrides", async () => {
    const catalog = B.listCatalog();
    const statuses = await S.listPromptStatuses(U, null);
    expect(statuses).toHaveLength(catalog.length);
    for (const s of statuses) {
      expect(s.source).toBe("system");
      expect(s.hasUserOverride).toBe(false);
      expect(s.hasProjectOverride).toBe(false);
      expect(s.drifted).toBe(false);
    }
  });

  it("reports source=user and hasUserOverride for a prompt with a user-layer row", async () => {
    dbState.rows = [
      { userId: U, projectId: "", promptId: "build_scenes", content: "{script_text}", baseVersion: "1", baseContent: "x", updatedAt: new Date() },
    ];
    const statuses = await S.listPromptStatuses(U, null);
    const row = statuses.find((s) => s.promptId === "build_scenes")!;
    expect(row.source).toBe("user");
    expect(row.hasUserOverride).toBe(true);
    expect(row.hasProjectOverride).toBe(false);
  });

  it("prefers project over user when both layers have a row for the same project", async () => {
    dbState.rows = [
      { userId: U, projectId: "", promptId: "build_scenes", content: "{script_text}", baseVersion: "1", baseContent: "x", updatedAt: new Date() },
      { userId: U, projectId: "proj-1", promptId: "build_scenes", content: "{script_text}", baseVersion: "1", baseContent: "x", updatedAt: new Date() },
    ];
    const statuses = await S.listPromptStatuses(U, "proj-1");
    const row = statuses.find((s) => s.promptId === "build_scenes")!;
    expect(row.source).toBe("project");
    expect(row.hasUserOverride).toBe(true);
    expect(row.hasProjectOverride).toBe(true);
  });

  it("does not leak another user's override", async () => {
    dbState.rows = [
      { userId: OTHER_U, projectId: "", promptId: "build_scenes", content: "{script_text}", baseVersion: "1", baseContent: "x", updatedAt: new Date() },
    ];
    const statuses = await S.listPromptStatuses(U, null);
    const row = statuses.find((s) => s.promptId === "build_scenes")!;
    expect(row.source).toBe("system");
  });

  it("flags drifted when a user override's baseVersion no longer matches the catalog", async () => {
    dbState.rows = [
      { userId: U, projectId: "", promptId: "build_scenes", content: "{script_text}", baseVersion: "0", baseContent: "x", updatedAt: new Date() },
    ];
    const statuses = await S.listPromptStatuses(U, null);
    const row = statuses.find((s) => s.promptId === "build_scenes")!;
    expect(row.drifted).toBe(true);
  });
});

describe("getPromptDetail", () => {
  it("returns null for an unknown promptId", async () => {
    const detail = await S.getPromptDetail(U, "not-a-real-prompt", null);
    expect(detail).toBeNull();
  });

  it("returns system text, null layers, and effective=system when there is no override", async () => {
    const detail = await S.getPromptDetail(U, "build_scenes", null);
    expect(detail).not.toBeNull();
    expect(detail!.user).toBeNull();
    expect(detail!.project).toBeNull();
    expect(detail!.effective.source).toBe("system");
    expect(detail!.effective.content).toBe(detail!.system);
  });

  it("surfaces the user layer content and baseContent snapshot", async () => {
    dbState.rows = [
      {
        userId: U,
        projectId: "",
        promptId: "build_scenes",
        content: "{script_text} USER",
        baseVersion: "1",
        baseContent: "SNAPSHOT",
        updatedAt: new Date("2026-07-21T00:00:00Z"),
      },
    ];
    const detail = await S.getPromptDetail(U, "build_scenes", null);
    expect(detail!.user).toEqual({
      content: "{script_text} USER",
      baseVersion: "1",
      baseContent: "SNAPSHOT",
      updatedAt: "2026-07-21T00:00:00.000Z",
    });
    expect(detail!.project).toBeNull();
    expect(detail!.effective.source).toBe("user");
    expect(detail!.effective.content).toBe("{script_text} USER");
  });

  it("surfaces both layers and lets project win the effective content when scoped to that project", async () => {
    dbState.rows = [
      { userId: U, projectId: "", promptId: "build_scenes", content: "USER", baseVersion: "1", baseContent: "x", updatedAt: new Date() },
      { userId: U, projectId: "proj-1", promptId: "build_scenes", content: "PROJECT", baseVersion: "1", baseContent: "x", updatedAt: new Date() },
    ];
    const detail = await S.getPromptDetail(U, "build_scenes", "proj-1");
    expect(detail!.user).not.toBeNull();
    expect(detail!.project).not.toBeNull();
    expect(detail!.effective.source).toBe("project");
    expect(detail!.effective.content).toBe("PROJECT");
  });

  it("does not pull in a different project's row", async () => {
    dbState.rows = [
      { userId: U, projectId: "proj-1", promptId: "build_scenes", content: "PROJECT", baseVersion: "1", baseContent: "x", updatedAt: new Date() },
    ];
    const detail = await S.getPromptDetail(U, "build_scenes", "proj-2");
    expect(detail!.project).toBeNull();
    expect(detail!.effective.source).toBe("system");
  });
});
