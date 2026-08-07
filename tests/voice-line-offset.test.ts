// 成片時間軸嘅 PATCH 擴充：offsetMs clamp／null 重設，matchedShotId 換鏡必須
// 同 user 同 episode（一個 where 齊截跨集／跨租戶）。
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
  line: null as null | {
    id: string;
    userId: string;
    episodeId: string;
    speaker: string;
    characterId: string | null;
    matchedShotId: string | null;
  },
  // shot.findFirst honors the where-clause the route sends（同 user 同 episode 先中）
  shots: [] as { id: string; userId: string; episodeId: string }[],
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
    character: { findFirst: vi.fn(async () => null) },
    shot: {
      findFirst: vi.fn(async (args: { where: { id: string; userId: string; episodeId: string } }) => {
        const s = db.shots.find(
          (sh) => sh.id === args.where.id && sh.userId === args.where.userId && sh.episodeId === args.where.episodeId,
        );
        return s ? { id: s.id } : null;
      }),
    },
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

const baseLine = () => ({
  id: "vl1",
  userId: "u1",
  episodeId: "e1",
  speaker: "陳沉",
  characterId: null,
  matchedShotId: "shot-1",
});

describe("PATCH /api/voice-lines/[id] — timeline fields", () => {
  it("clamps negative offsetMs to 0", async () => {
    db.line = baseLine();
    db.updated = null;
    await call({ offsetMs: -50 });
    expect((db.updated as { offsetMs: number }).offsetMs).toBe(0);
  });

  it("clamps offsetMs above 600000 to 600000", async () => {
    db.line = baseLine();
    db.updated = null;
    await call({ offsetMs: 999_999 });
    expect((db.updated as { offsetMs: number }).offsetMs).toBe(600_000);
  });

  it("rounds fractional offsetMs", async () => {
    db.line = baseLine();
    db.updated = null;
    await call({ offsetMs: 123.7 });
    expect((db.updated as { offsetMs: number }).offsetMs).toBe(124);
  });

  it("offsetMs null resets to auto placement", async () => {
    db.line = baseLine();
    db.updated = null;
    await call({ offsetMs: null });
    expect((db.updated as { offsetMs: number | null }).offsetMs).toBeNull();
  });

  it("non-number offsetMs is dropped (matchedShotId untouched too)", async () => {
    db.line = baseLine();
    db.updated = null;
    await call({ offsetMs: "abc" });
    expect((db.updated as { offsetMs?: number }).offsetMs).toBeUndefined();
    expect((db.updated as { matchedShotId: string }).matchedShotId).toBe("shot-1");
  });

  it("rejects a shot from another episode with SHOT_NOT_IN_EPISODE", async () => {
    db.line = baseLine();
    db.shots = [{ id: "shot-other", userId: "u1", episodeId: "e2" }];
    await expect(call({ matchedShotId: "shot-other" })).rejects.toMatchObject({
      code: "SHOT_NOT_IN_EPISODE",
      status: 400,
    });
  });

  it("rejects another user's shot with SHOT_NOT_IN_EPISODE", async () => {
    db.line = baseLine();
    db.shots = [{ id: "shot-x", userId: "u2", episodeId: "e1" }];
    await expect(call({ matchedShotId: "shot-x" })).rejects.toMatchObject({ code: "SHOT_NOT_IN_EPISODE" });
  });

  it("accepts a same-episode shot and rebinds", async () => {
    db.line = baseLine();
    db.shots = [{ id: "shot-2", userId: "u1", episodeId: "e1" }];
    db.updated = null;
    await call({ matchedShotId: "shot-2", offsetMs: 1500 });
    expect((db.updated as { matchedShotId: string }).matchedShotId).toBe("shot-2");
    expect((db.updated as { offsetMs: number }).offsetMs).toBe(1500);
  });

  it("matchedShotId null clears the binding", async () => {
    db.line = baseLine();
    db.updated = null;
    await call({ matchedShotId: null });
    expect((db.updated as { matchedShotId: string | null }).matchedShotId).toBeNull();
  });
});
