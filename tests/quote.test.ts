// estimateTaskCost against a real Postgres (same style as billing.test.ts).
// The behavior change under test: a project with empty modelDefaults is now
// priced from the real SYSTEM defaults (not $0/fake), because the quote resolves
// through the same three-layer resolver the worker runs.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  /* no .env — fall back to defaults below */
}
process.env.DATABASE_URL ||= "postgresql://reelcraft@localhost:5432/reelcraft";
process.env.REDIS_URL ||= "redis://localhost:6379";
process.env.STORAGE_ENDPOINT ||= "http://localhost:19000";
process.env.STORAGE_ACCESS_KEY ||= "test";
process.env.STORAGE_SECRET_KEY ||= "test";
process.env.STORAGE_BUCKET ||= "test";
process.env.BETTER_AUTH_SECRET ||= "test-secret";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
// Ensure the real system defaults (not the fake preset) drive pricing here.
delete process.env.MODEL_DEFAULTS_PRESET;

type QuoteMod = typeof import("@/lib/billing/quote");
type DbMod = typeof import("@/lib/db");

let quote: QuoteMod;
let prisma: DbMod["prisma"];
let TASK_TYPE: typeof import("@/lib/task/types").TASK_TYPE;

const userIds: string[] = [];
const projectIds: string[] = [];

async function makeUser(): Promise<string> {
  const id = randomUUID();
  await prisma.user.create({ data: { id, name: "quote-test", email: `quote-${id}@test.local` } });
  userIds.push(id);
  return id;
}

async function makeProject(userId: string, modelDefaults: Record<string, string> = {}): Promise<string> {
  const id = randomUUID();
  await prisma.project.create({ data: { id, userId, name: "quote-test", modelDefaults } });
  projectIds.push(id);
  return id;
}

beforeAll(async () => {
  quote = await import("@/lib/billing/quote");
  ({ prisma } = await import("@/lib/db"));
  ({ TASK_TYPE } = await import("@/lib/task/types"));
});

afterAll(async () => {
  for (const id of projectIds) await prisma.project.deleteMany({ where: { id } });
  for (const id of userIds) await prisma.user.deleteMany({ where: { id } });
  await prisma.$disconnect();
});

describe("estimateTaskCost — empty project defaults now price from SYSTEM defaults", () => {
  it("IMAGE_SHOT is priced at the system image model (nano-banana-pro, $0.10)", async () => {
    const u = await makeUser();
    const p = await makeProject(u, {});
    const cost = await quote.estimateTaskCost(TASK_TYPE.IMAGE_SHOT, u, {}, p);
    expect(cost).toBeCloseTo(0.1, 6);
  });

  it("VIDEO_SHOT is priced at the system video model × its worst duration (kling-v3, $0.28 × 10s)", async () => {
    const u = await makeUser();
    const p = await makeProject(u, {});
    const cost = await quote.estimateTaskCost(TASK_TYPE.VIDEO_SHOT, u, {}, p);
    expect(cost).toBeCloseTo(2.8, 6);
  });

  it("TTS_LINE is priced at the system tts model × char count (minimax, $5e-5/char)", async () => {
    const u = await makeUser();
    const p = await makeProject(u, {});
    const cost = await quote.estimateTaskCost(TASK_TYPE.TTS_LINE, u, { charCount: 200 }, p);
    expect(cost).toBeCloseTo(200 * 5e-5, 8);
  });
});

describe("estimateTaskCost — project override respected", () => {
  it("uses the project's image model when it sets one", async () => {
    const u = await makeUser();
    // seedream v4 t2i is $0.03/image in the catalog
    const p = await makeProject(u, { image: "fal::fal-ai/bytedance/seedream/v4/text-to-image" });
    const cost = await quote.estimateTaskCost(TASK_TYPE.IMAGE_SHOT, u, {}, p);
    expect(cost).toBeCloseTo(0.03, 6);
  });

  it("falls back to the system model when the project's override is illegal (not $0)", async () => {
    const u = await makeUser();
    const p = await makeProject(u, { image: "garbage::not-real" });
    const cost = await quote.estimateTaskCost(TASK_TYPE.IMAGE_SHOT, u, {}, p);
    expect(cost).toBeCloseTo(0.1, 6); // system nano-banana-pro, NOT 0
  });
});
