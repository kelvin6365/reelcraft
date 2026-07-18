// Billing balance for the signed-in user: spendable balance, held (frozen)
// funds, lifetime spend, and the last 20 ledger entries. `mode` lets the UI
// hide the balance chip when billing is OFF. Money crosses the wire as numbers
// (display edge only) — the ledger stays Decimal end to end.
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ok } from "@/lib/api/errors";
import { env } from "@/lib/env";

export const GET = withAuth(async ({ userId }) => {
  const [balance, recent] = await Promise.all([
    prisma.userBalance.findUnique({ where: { userId } }),
    prisma.balanceTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return ok({
    mode: env.BILLING_MODE,
    balanceUsd: Number(balance?.balanceUsd ?? 0),
    frozenUsd: Number(balance?.frozenUsd ?? 0),
    totalSpentUsd: Number(balance?.totalSpentUsd ?? 0),
    recentTransactions: recent.map((t) => ({
      id: String(t.id),
      type: t.type,
      amountUsd: Number(t.amountUsd),
      balanceAfterUsd: Number(t.balanceAfterUsd),
      note: t.note,
      createdAt: t.createdAt.toISOString(),
    })),
  });
});
