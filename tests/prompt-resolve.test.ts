import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mirrors tests/model-defaults.test.ts: vi.hoisted mutable state box + vi.mock
// db, so only prisma.promptOverride.findMany is faked — the real catalog +
// real prompt files are used throughout (never mocked).
interface OverrideRow {
  userId: string;
  projectId: string;
  promptId: string;
  content: string;
  baseVersion: string;
  baseContent: string;
}
const dbState = vi.hoisted(() => ({ rows: [] as OverrideRow[], findManyCalls: 0 }));
vi.mock("@/lib/db", () => ({
  prisma: {
    promptOverride: {
      findMany: vi.fn(async (args: { where: { userId: string; promptId: string; projectId: { in: string[] } } }) => {
        dbState.findManyCalls++;
        const { userId, promptId, projectId } = args.where;
        return dbState.rows.filter(
          (r) => r.userId === userId && r.promptId === promptId && projectId.in.includes(r.projectId),
        );
      }),
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

type ResolveMod = typeof import("@/lib/prompts/resolve-prompt");
type BuildMod = typeof import("@/lib/prompts/build-prompt");
let R: ResolveMod;
let B: BuildMod;

const U = "user-1";
const OTHER_U = "user-2";

beforeAll(async () => {
  R = await import("@/lib/prompts/resolve-prompt");
  B = await import("@/lib/prompts/build-prompt");
});

beforeEach(() => {
  dbState.rows = [];
  dbState.findManyCalls = 0;
  B.clearPromptCache();
});

describe("resolvePrompt — no override", () => {
  it("falls to system and matches buildPrompt byte-for-byte", async () => {
    const variables = { script_text: "阿May推門而入。" };
    const built = B.buildPrompt("build_scenes", variables);
    const resolved = await R.resolvePrompt("build_scenes", variables, { userId: U, projectId: null });
    expect(resolved.text).toBe(built.text);
    expect(resolved.version).toBe(built.version);
    expect(resolved.source).toBe("system");
    expect(resolved.drifted).toBe(false);
    expect(resolved.baseVersion).toBeUndefined();
  });
});

describe("resolvePrompt — layering", () => {
  const variables = { script_text: "SCENE X" };

  it("uses the user-layer override when present", async () => {
    dbState.rows = [
      { userId: U, projectId: "", promptId: "build_scenes", content: "USER OVERRIDE {script_text}", baseVersion: "1", baseContent: "x" },
    ];
    const r = await R.resolvePrompt("build_scenes", variables, { userId: U, projectId: null });
    expect(r.source).toBe("user");
    expect(r.text).toBe("USER OVERRIDE SCENE X");
    expect(r.baseVersion).toBe("1");
  });

  it("lets a project override win over a user override for the same promptId", async () => {
    dbState.rows = [
      { userId: U, projectId: "", promptId: "build_scenes", content: "USER {script_text}", baseVersion: "1", baseContent: "x" },
      { userId: U, projectId: "proj-1", promptId: "build_scenes", content: "PROJECT {script_text}", baseVersion: "1", baseContent: "x" },
    ];
    const r = await R.resolvePrompt("build_scenes", variables, { userId: U, projectId: "proj-1" });
    expect(r.source).toBe("project");
    expect(r.text).toBe("PROJECT SCENE X");
  });

  it("does not apply a project override when resolving without a projectId", async () => {
    dbState.rows = [
      { userId: U, projectId: "", promptId: "build_scenes", content: "USER {script_text}", baseVersion: "1", baseContent: "x" },
      { userId: U, projectId: "proj-1", promptId: "build_scenes", content: "PROJECT {script_text}", baseVersion: "1", baseContent: "x" },
    ];
    const r = await R.resolvePrompt("build_scenes", variables, { userId: U, projectId: null });
    expect(r.source).toBe("user");
    expect(r.text).toBe("USER SCENE X");
  });

  it("another promptId's override does not leak into this resolution", async () => {
    dbState.rows = [
      { userId: U, projectId: "", promptId: "storyboard_plan", content: "SHOULD NOT APPEAR", baseVersion: "1", baseContent: "x" },
    ];
    const r = await R.resolvePrompt("build_scenes", variables, { userId: U, projectId: null });
    expect(r.source).toBe("system");
  });

  it("scopes overrides by userId — another user's row doesn't leak", async () => {
    dbState.rows = [
      { userId: OTHER_U, projectId: "", promptId: "build_scenes", content: "OTHER USER {script_text}", baseVersion: "1", baseContent: "x" },
    ];
    const r = await R.resolvePrompt("build_scenes", variables, { userId: U, projectId: null });
    expect(r.source).toBe("system");
  });
});

describe("resolvePrompt — one-off text", () => {
  const variables = { script_text: "ONE OFF" };

  it("wins outright and never touches the DB", async () => {
    dbState.rows = [
      { userId: U, projectId: "", promptId: "build_scenes", content: "USER {script_text}", baseVersion: "1", baseContent: "x" },
    ];
    const r = await R.resolvePrompt("build_scenes", variables, {
      userId: U,
      projectId: null,
      oneOffText: "ONEOFF {script_text}",
    });
    expect(r.source).toBe("oneoff");
    expect(r.text).toBe("ONEOFF ONE OFF");
    expect(dbState.findManyCalls).toBe(0);
  });
});

describe("resolvePrompt — strict placeholder validation", () => {
  it("throws PROMPT_OVERRIDE_INVALID (retryable=false) when a declared var is missing from the override", async () => {
    dbState.rows = [
      { userId: U, projectId: "", promptId: "build_scenes", content: "NO PLACEHOLDER HERE", baseVersion: "1", baseContent: "x" },
    ];
    await expect(R.resolvePrompt("build_scenes", { script_text: "x" }, { userId: U, projectId: null })).rejects.toMatchObject({
      code: "PROMPT_OVERRIDE_INVALID",
      retryable: false,
    });
  });

  it("throws PROMPT_OVERRIDE_INVALID when the override has an extra undeclared placeholder", async () => {
    dbState.rows = [
      {
        userId: U,
        projectId: "",
        promptId: "build_scenes",
        content: "{script_text} and also {bogus}",
        baseVersion: "1",
        baseContent: "x",
      },
    ];
    await expect(R.resolvePrompt("build_scenes", { script_text: "x" }, { userId: U, projectId: null })).rejects.toMatchObject({
      code: "PROMPT_OVERRIDE_INVALID",
      retryable: false,
    });
  });

  it("rejects a one-off override the same way", async () => {
    await expect(
      R.resolvePrompt("build_scenes", { script_text: "x" }, { userId: U, projectId: null, oneOffText: "no placeholder" }),
    ).rejects.toMatchObject({ code: "PROMPT_OVERRIDE_INVALID", retryable: false });
  });
});

describe("resolvePrompt — drift", () => {
  it("flags drifted=true when baseVersion no longer matches the catalog version", async () => {
    dbState.rows = [
      { userId: U, projectId: "", promptId: "build_scenes", content: "{script_text}", baseVersion: "0", baseContent: "x" },
    ];
    const r = await R.resolvePrompt("build_scenes", { script_text: "x" }, { userId: U, projectId: null });
    expect(r.drifted).toBe(true);
    expect(r.version).not.toBe(r.baseVersion);
  });

  it("flags drifted=false when baseVersion matches the current catalog version", async () => {
    const entry = B.getCatalogEntry("build_scenes")!;
    dbState.rows = [
      { userId: U, projectId: "", promptId: "build_scenes", content: "{script_text}", baseVersion: entry.version, baseContent: "x" },
    ];
    const r = await R.resolvePrompt("build_scenes", { script_text: "x" }, { userId: U, projectId: null });
    expect(r.drifted).toBe(false);
    // version is always the current catalog version, even when an override wins
    expect(r.version).toBe(entry.version);
  });
});
