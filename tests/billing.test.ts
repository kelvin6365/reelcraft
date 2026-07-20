// Billing ledger tests against a real Postgres (the DATABASE_URL in .env).
// Env is seeded before the modules under test are dynamically imported, because
// @/lib/env validates process.env at import time. Each test uses its own throwaway
// user so cases can't bleed into one another; all rows are cleaned up in afterAll.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

try {
  // Load the local .env so we hit the real dev database; harmless if absent (CI).
  process.loadEnvFile(".env");
} catch {
  /* no .env — fall back to the defaults below */
}
process.env.DATABASE_URL ||= "postgresql://reelcraft@localhost:5432/reelcraft";
process.env.REDIS_URL ||= "redis://localhost:6379";
process.env.STORAGE_ENDPOINT ||= "http://localhost:19000";
process.env.STORAGE_ACCESS_KEY ||= "test";
process.env.STORAGE_SECRET_KEY ||= "test";
process.env.STORAGE_BUCKET ||= "test";
process.env.BETTER_AUTH_SECRET ||= "test-secret";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";

type LedgerMod = typeof import("@/lib/billing/ledger");
type DbMod = typeof import("@/lib/db");

let ledger: LedgerMod;
let prisma: DbMod["prisma"];

const userIds: string[] = [];

// Fresh, isolated user with a starting balance. Tracked for teardown.
async function makeUser(startingUsd = 0): Promise<string> {
  const id = randomUUID();
  await prisma.user.create({ data: { id, name: "billing-test", email: `bill-${id}@test.local` } });
  userIds.push(id);
  if (startingUsd > 0) await ledger.addBalance(id, startingUsd, `seed:${id}`, "test seed");
  return id;
}

async function balance(userId: string): Promise<{ balance: number; frozen: number; spent: number }> {
  const row = await prisma.userBalance.findUnique({ where: { userId } });
  return {
    balance: Number(row?.balanceUsd ?? 0),
    frozen: Number(row?.frozenUsd ?? 0),
    spent: Number(row?.totalSpentUsd ?? 0),
  };
}

beforeAll(async () => {
  ledger = await import("@/lib/billing/ledger");
  ({ prisma } = await import("@/lib/db"));
});

afterAll(async () => {
  for (const userId of userIds) {
    await prisma.aiCallLog.deleteMany({ where: { userId } });
    await prisma.balanceTransaction.deleteMany({ where: { userId } });
    await prisma.balanceFreeze.deleteMany({ where: { userId } });
    await prisma.userBalance.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }
  await prisma.$disconnect();
});

describe("addBalance", () => {
  it("credits balance and is idempotent on the same key", async () => {
    const u = await makeUser();
    await ledger.addBalance(u, 5, "r1", "first");
    await ledger.addBalance(u, 5, "r1", "dup"); // same key → no double credit
    await ledger.addBalance(u, 2, "r2", "second"); // new key → credited
    expect((await balance(u)).balance).toBeCloseTo(7, 6);

    const recharges = await prisma.balanceTransaction.count({ where: { userId: u, type: "recharge" } });
    expect(recharges).toBe(2);
  });
});

describe("freezeBalance", () => {
  it("moves funds balance → frozen (atomic CAS)", async () => {
    const u = await makeUser(10);
    await ledger.freezeBalance(u, 3, "f1");
    const b = await balance(u);
    expect(b.balance).toBeCloseTo(7, 6);
    expect(b.frozen).toBeCloseTo(3, 6);
  });

  it("rejects when the balance can't cover the reservation", async () => {
    const u = await makeUser(10);
    await expect(ledger.freezeBalance(u, 20, "f-too-big")).rejects.toBeInstanceOf(ledger.InsufficientBalanceError);
    const b = await balance(u);
    expect(b.balance).toBeCloseTo(10, 6); // untouched
    expect(b.frozen).toBeCloseTo(0, 6);
  });

  it("is idempotent on idempotencyKey — a repeat reserves nothing extra", async () => {
    const u = await makeUser(10);
    const id1 = await ledger.freezeBalance(u, 3, "same-key");
    const id2 = await ledger.freezeBalance(u, 3, "same-key");
    expect(id2).toBe(id1);
    const b = await balance(u);
    expect(b.balance).toBeCloseTo(7, 6); // reserved once, not twice
    expect(b.frozen).toBeCloseTo(3, 6);
  });
});

describe("settleFreeze", () => {
  it("charges actual and refunds the over-reservation", async () => {
    const u = await makeUser(10);
    const freezeId = await ledger.freezeBalance(u, 3, "s1");
    await ledger.settleFreeze(freezeId, 2);
    const b = await balance(u);
    expect(b.balance).toBeCloseTo(8, 6); // 7 held + 1 refunded
    expect(b.frozen).toBeCloseTo(0, 6);
    expect(b.spent).toBeCloseTo(2, 6);

    const freeze = await prisma.balanceFreeze.findUnique({ where: { id: freezeId } });
    expect(freeze?.status).toBe("confirmed");
    const consume = await prisma.balanceTransaction.findFirst({ where: { userId: u, type: "consume" } });
    expect(Number(consume?.amountUsd)).toBeCloseTo(2, 6);
  });

  it("charges at most the frozen amount when actual overshoots (no overdraft)", async () => {
    const u = await makeUser(10);
    const freezeId = await ledger.freezeBalance(u, 3, "s-over");
    await ledger.settleFreeze(freezeId, 5); // actual > frozen
    const b = await balance(u);
    expect(b.balance).toBeCloseTo(7, 6); // no refund, no extra charge beyond frozen
    expect(b.frozen).toBeCloseTo(0, 6);
    expect(b.spent).toBeCloseTo(3, 6);
  });

  it("is idempotent — a re-settle is a no-op", async () => {
    const u = await makeUser(10);
    const freezeId = await ledger.freezeBalance(u, 3, "s-idem");
    await ledger.settleFreeze(freezeId, 2);
    await ledger.settleFreeze(freezeId, 2); // second call must not double-charge
    const b = await balance(u);
    expect(b.balance).toBeCloseTo(8, 6);
    expect(b.spent).toBeCloseTo(2, 6);
    const consumes = await prisma.balanceTransaction.count({ where: { userId: u, type: "consume" } });
    expect(consumes).toBe(1);
  });
});

describe("rollbackFreeze", () => {
  it("refunds the whole reservation", async () => {
    const u = await makeUser(10);
    const freezeId = await ledger.freezeBalance(u, 3, "rb1");
    await ledger.rollbackFreeze(freezeId);
    const b = await balance(u);
    expect(b.balance).toBeCloseTo(10, 6);
    expect(b.frozen).toBeCloseTo(0, 6);
    expect(b.spent).toBeCloseTo(0, 6);
    const freeze = await prisma.balanceFreeze.findUnique({ where: { id: freezeId } });
    expect(freeze?.status).toBe("rolled_back");
  });

  it("is idempotent and won't over-refund", async () => {
    const u = await makeUser(10);
    const freezeId = await ledger.freezeBalance(u, 3, "rb-idem");
    await ledger.rollbackFreeze(freezeId);
    await ledger.rollbackFreeze(freezeId); // no-op
    const b = await balance(u);
    expect(b.balance).toBeCloseTo(10, 6);
    const refunds = await prisma.balanceTransaction.count({ where: { userId: u, type: "refund" } });
    expect(refunds).toBe(1);
  });

  it("won't settle a freeze that was already rolled back", async () => {
    const u = await makeUser(10);
    const freezeId = await ledger.freezeBalance(u, 3, "rb-then-settle");
    await ledger.rollbackFreeze(freezeId);
    await ledger.settleFreeze(freezeId, 2); // must no-op — freeze is terminal
    const b = await balance(u);
    expect(b.balance).toBeCloseTo(10, 6);
    expect(b.spent).toBeCloseTo(0, 6);
  });
});

describe("sumActualCostUsd", () => {
  it("prefers provider-billed cost per row, falls back to the estimate", async () => {
    const { sumActualCostUsd } = await import("@/lib/billing/actual-cost");
    const u = await makeUser();
    const taskId = `task-${randomUUID()}`;
    await prisma.aiCallLog.createMany({
      data: [
        // provider billed less than our estimate → real number wins
        { userId: u, taskId, modelKey: "openrouter::m", apiType: "text", status: "ok", estCostUsd: 0.02, providerCostUsd: 0.015 },
        // media row: never provider-costed → estimate
        { userId: u, taskId, modelKey: "fal::m", apiType: "image", status: "ok", estCostUsd: 0.039, providerCostUsd: null },
        // provider cost 0 (free model) is respected, not treated as missing
        { userId: u, taskId, modelKey: "openrouter::free", apiType: "text", status: "ok", estCostUsd: 0.01, providerCostUsd: 0 },
        // error rows excluded by the caller's where
        { userId: u, taskId, modelKey: "openrouter::m", apiType: "text", status: "error", estCostUsd: 5, providerCostUsd: 5 },
      ],
    });
    const sum = await sumActualCostUsd({ taskId, status: "ok" });
    expect(Number(sum)).toBeCloseTo(0.015 + 0.039 + 0, 6);
  });
});

describe("concurrency", () => {
  it("10 parallel freezes racing on a balance that covers 5 → exactly 5 succeed", async () => {
    const amount = 2;
    const u = await makeUser(10); // covers exactly 5 reservations of $2
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => ledger.freezeBalance(u, amount, `race-${i}`)),
    );

    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(5);
    expect(rejected).toHaveLength(5);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ledger.InsufficientBalanceError);
    }

    const b = await balance(u);
    expect(b.balance).toBeCloseTo(0, 6);
    expect(b.frozen).toBeCloseTo(10, 6);
    const freezes = await prisma.balanceFreeze.count({ where: { userId: u, status: "pending" } });
    expect(freezes).toBe(5);
  });
});
