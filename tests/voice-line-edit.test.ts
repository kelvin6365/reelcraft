// The PATCH route re-binds characterId when the speaker changes — the mechanism
// that keeps a re-attributed line on the right character's voice (火豹 #85).
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

const db = vi.hoisted(() => ({
  line: null as null | { id: string; userId: string; episodeId: string; speaker: string; characterId: string | null },
  characterByName: {} as Record<string, { id: string }>,
  updated: null as unknown,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    voiceLine: {
      findFirst: vi.fn(async () => db.line),
      update: vi.fn(async (args: { data: unknown }) => {
        db.updated = args.data;
        return { ...db.line, ...(args.data as object) };
      }),
    },
    episode: { findUniqueOrThrow: vi.fn(async () => ({ projectId: "p1" })) },
    character: { findFirst: vi.fn(async (args: { where: { name: string } }) => db.characterByName[args.where.name] ?? null) },
  },
}));
vi.mock("@/lib/api/with-auth", () => ({
  withAuth: (fn: unknown) => fn,
}));
vi.mock("@/lib/api/errors", () => ({
  ok: (data: unknown) => ({ data }),
  fail: (code: string, status: number) => ({ code, status }),
  ApiError: class extends Error {
    constructor(
      public code: string,
      public status: number,
    ) {
      super(code);
    }
  },
}));

type Route = typeof import("@/app/api/voice-lines/[id]/route");
let route: Route;
beforeAll(async () => {
  route = await import("@/app/api/voice-lines/[id]/route");
});

const call = (body: unknown) =>
  (route.PATCH as unknown as (a: { userId: string; params: { id: string }; req: { json: () => Promise<unknown> } }) => Promise<unknown>)({
    userId: "u1",
    params: { id: "vl1" },
    req: { json: async () => body },
  });

describe("PATCH /api/voice-lines/[id]", () => {
  it("re-binds characterId to a matching character when the speaker changes", async () => {
    db.line = { id: "vl1", userId: "u1", episodeId: "e1", speaker: "旁白", characterId: null };
    db.characterByName = { 陳沉: { id: "char-chen" } };
    db.updated = null;
    await call({ speaker: "陳沉" });
    expect((db.updated as { characterId: string }).characterId).toBe("char-chen");
  });

  it("clears the binding when the new speaker is not a known character", async () => {
    db.line = { id: "vl1", userId: "u1", episodeId: "e1", speaker: "陳沉", characterId: "char-chen" };
    db.characterByName = {};
    db.updated = null;
    await call({ speaker: "旁白" });
    expect((db.updated as { characterId: string | null }).characterId).toBeNull();
  });

  it("leaves the binding untouched when only content changes", async () => {
    db.line = { id: "vl1", userId: "u1", episodeId: "e1", speaker: "陳沉", characterId: "char-chen" };
    db.updated = null;
    await call({ content: "改咗嘅台詞" });
    expect((db.updated as { characterId: string | null }).characterId).toBe("char-chen");
  });

  it("caps emotionStrength at the analyzer's 0.5 hard limit", async () => {
    db.line = { id: "vl1", userId: "u1", episodeId: "e1", speaker: "陳沉", characterId: "char-chen" };
    db.updated = null;
    await call({ emotionStrength: 0.9 });
    expect((db.updated as { emotionStrength: number }).emotionStrength).toBe(0.5);
  });
});
