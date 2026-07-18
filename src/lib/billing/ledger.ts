// Billing ledger — the reserve → settle → refund shape (M3-T3, ENFORCE mode).
//
// Money is Prisma.Decimal end to end; floats are used only at the display edge
// (API/UI). The core operations are:
//   freezeBalance  — reserve funds before work starts (atomic CAS, idempotent)
//   settleFreeze   — charge actual cost, refund the over-reservation
//   rollbackFreeze — release the whole reservation on failure
//   addBalance     — credit funds (recharge), idempotent
//
// Every mutation is idempotent so worker retries and double-delivery never
// double-charge or double-refund.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";
import { env } from "@/lib/env";

const ZERO = new Prisma.Decimal(0);

function dec(v: Prisma.Decimal | number | string): Prisma.Decimal {
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

// Raised when a user's spendable balance can't cover a reservation. The task
// flow turns this into a terminal INSUFFICIENT_BALANCE task (never enqueued).
export class InsufficientBalanceError extends Error {
  constructor(
    public required: number,
    public available: number,
  ) {
    super(`insufficient balance: need $${required.toFixed(6)}, have $${available.toFixed(6)}`);
    this.name = "InsufficientBalanceError";
  }
}

async function balanceOf(userId: string): Promise<Prisma.Decimal> {
  const row = await prisma.userBalance.findUnique({ where: { userId }, select: { balanceUsd: true } });
  return row ? dec(row.balanceUsd) : ZERO;
}

// Reserve `amountUsd` for a user: atomically move it balance → frozen, and
// record a pending BalanceFreeze. Returns the freeze id.
//
// The CAS `updateMany({where:{balanceUsd:{gte:amount}}})` is the concurrency
// guard — Postgres row-locks serialize racing reservations, so exactly as many
// succeed as the balance can cover; the rest see count===0 → insufficient.
//
// Idempotent on `idempotencyKey`: a repeat call returns the existing freeze id
// and never reserves twice.
export async function freezeBalance(
  userId: string,
  amountUsd: Prisma.Decimal | number,
  idempotencyKey: string,
  taskId?: string,
): Promise<string> {
  const amount = dec(amountUsd);

  const existing = await prisma.balanceFreeze.findUnique({ where: { idempotencyKey } });
  if (existing) return existing.id;

  // Zero (or negative) reservations — e.g. fake/free providers — reserve nothing
  // but still record a freeze so settle/rollback stay uniform and don't need a
  // balance row to exist.
  if (amount.lte(ZERO)) {
    return createFreeze(userId, ZERO, idempotencyKey, taskId);
  }

  const cas = await prisma.userBalance.updateMany({
    where: { userId, balanceUsd: { gte: amount } },
    data: { balanceUsd: { decrement: amount }, frozenUsd: { increment: amount } },
  });
  if (cas.count === 0) {
    throw new InsufficientBalanceError(Number(amount), Number(await balanceOf(userId)));
  }

  try {
    return await createFreeze(userId, amount, idempotencyKey, taskId, /* reserved */ true);
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Lost an idempotency race: another call with the same key already holds
      // the reservation. Undo our CAS and return the winner's freeze.
      await prisma.userBalance.updateMany({
        where: { userId },
        data: { balanceUsd: { increment: amount }, frozenUsd: { decrement: amount } },
      });
      const winner = await prisma.balanceFreeze.findUnique({ where: { idempotencyKey } });
      if (winner) return winner.id;
    }
    throw err;
  }
}

async function createFreeze(
  userId: string,
  amount: Prisma.Decimal,
  idempotencyKey: string,
  taskId: string | undefined,
  reserved = false,
): Promise<string> {
  try {
    const freeze = await prisma.balanceFreeze.create({
      data: { id: newId(), userId, amountUsd: amount, status: "pending", taskId, idempotencyKey },
    });
    return freeze.id;
  } catch (err) {
    // For the zero-amount path there's no CAS to unwind, so collapse a duplicate
    // straight to the existing id. The reserved path handles unwinding upstream.
    if (!reserved && isUniqueViolation(err)) {
      const dup = await prisma.balanceFreeze.findUnique({ where: { idempotencyKey } });
      if (dup) return dup.id;
    }
    throw err;
  }
}

// Settle a reservation to its actual cost: pending → confirmed, release the full
// frozen amount, charge `actualUsd` to totalSpent, and refund the difference.
// If actual exceeds the reservation we charge only what was frozen (no surprise
// overdraft in v1). Idempotent: a re-settle (or settle after rollback) no-ops.
export async function settleFreeze(freezeId: string, actualUsd: Prisma.Decimal | number): Promise<void> {
  const freeze = await prisma.balanceFreeze.findUnique({ where: { id: freezeId } });
  if (!freeze) return;

  const flip = await prisma.balanceFreeze.updateMany({
    where: { id: freezeId, status: "pending" },
    data: { status: "confirmed", resolvedAt: new Date() },
  });
  if (flip.count === 0) return; // already confirmed or rolled back — idempotent no-op

  const frozen = dec(freeze.amountUsd);
  const actual = Prisma.Decimal.max(dec(actualUsd), ZERO);
  const charge = actual.gt(frozen) ? frozen : actual;
  const refund = frozen.sub(charge);

  await prisma.userBalance.updateMany({
    where: { userId: freeze.userId },
    data: {
      frozenUsd: { decrement: frozen },
      totalSpentUsd: { increment: charge },
      balanceUsd: { increment: refund },
    },
  });

  await writeTransaction(freeze.userId, "consume", charge, freezeId, `settle freeze ${freezeId}`);
}

// Release a reservation in full and refund it: pending → rolled_back. Idempotent.
export async function rollbackFreeze(freezeId: string): Promise<void> {
  const freeze = await prisma.balanceFreeze.findUnique({ where: { id: freezeId } });
  if (!freeze) return;

  const flip = await prisma.balanceFreeze.updateMany({
    where: { id: freezeId, status: "pending" },
    data: { status: "rolled_back", resolvedAt: new Date() },
  });
  if (flip.count === 0) return; // already resolved — idempotent no-op

  const frozen = dec(freeze.amountUsd);
  await prisma.userBalance.updateMany({
    where: { userId: freeze.userId },
    data: { frozenUsd: { decrement: frozen }, balanceUsd: { increment: frozen } },
  });

  await writeTransaction(freeze.userId, "refund", frozen, freezeId, `rollback freeze ${freezeId}`);
}

// Credit a user's balance (admin recharge / grant). Idempotent on
// [userId, 'recharge', idempotencyKey] — a repeat returns the current balance
// without re-crediting. Returns the resulting balance.
export async function addBalance(
  userId: string,
  amountUsd: Prisma.Decimal | number,
  idempotencyKey: string,
  note = "",
): Promise<Prisma.Decimal> {
  const amount = dec(amountUsd);

  const already = await prisma.balanceTransaction.findUnique({
    where: { userId_type_idempotencyKey: { userId, type: "recharge", idempotencyKey } },
  });
  if (already) return balanceOf(userId);

  const balance = await prisma.userBalance.upsert({
    where: { userId },
    create: { userId, balanceUsd: amount },
    update: { balanceUsd: { increment: amount } },
  });

  try {
    await prisma.balanceTransaction.create({
      data: {
        userId,
        type: "recharge",
        amountUsd: amount,
        balanceAfterUsd: balance.balanceUsd,
        idempotencyKey,
        note,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Lost a race: the credit was applied twice but the ledger row exists once.
      // Undo our increment so the balance matches the single recorded recharge.
      await prisma.userBalance.update({
        where: { userId },
        data: { balanceUsd: { decrement: amount } },
      });
      return balanceOf(userId);
    }
    throw err;
  }
  return balance.balanceUsd;
}

async function writeTransaction(
  userId: string,
  type: "consume" | "refund",
  amount: Prisma.Decimal,
  freezeId: string,
  note: string,
): Promise<void> {
  const after = await balanceOf(userId);
  try {
    await prisma.balanceTransaction.create({
      data: { userId, type, amountUsd: amount, balanceAfterUsd: after, freezeId, idempotencyKey: freezeId, note },
    });
  } catch (err) {
    // A consume and a refund for the same freeze can't both happen (the freeze
    // status flip is exclusive), so a duplicate here means a benign re-entry.
    if (!isUniqueViolation(err)) throw err;
  }
}

// ---- Task-level helpers (wired into the worker lifecycle) -------------------
// These no-op unless BILLING_MODE === "ENFORCE", so lifecycle can call them
// unconditionally. In SHADOW/OFF no freeze was ever created, so they'd no-op
// regardless; the mode gate just avoids the lookups.

export async function settleTaskFreeze(taskId: string): Promise<void> {
  if (env.BILLING_MODE !== "ENFORCE") return;
  const freeze = await prisma.balanceFreeze.findFirst({ where: { taskId, status: "pending" } });
  if (!freeze) return;
  const agg = await prisma.aiCallLog.aggregate({
    where: { taskId, status: "ok" },
    _sum: { estCostUsd: true },
  });
  const actual = agg._sum.estCostUsd ?? ZERO;
  await settleFreeze(freeze.id, actual);
}

export async function rollbackTaskFreeze(taskId: string): Promise<void> {
  if (env.BILLING_MODE !== "ENFORCE") return;
  const freeze = await prisma.balanceFreeze.findFirst({ where: { taskId, status: "pending" } });
  if (!freeze) return;
  await rollbackFreeze(freeze.id);
}
