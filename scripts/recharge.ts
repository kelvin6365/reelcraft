// Admin recharge: credit a user's billing balance by email.
// Usage: npx tsx --env-file=.env scripts/recharge.ts <email> <amountUsd>
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { addBalance } from "../src/lib/billing/ledger";

async function main() {
  const email = process.argv[2];
  const amountRaw = process.argv[3];
  if (!email || !amountRaw) throw new Error("usage: recharge.ts <email> <amountUsd>");

  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`invalid amount: ${amountRaw}`);

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
  if (!user) throw new Error(`no user with email ${email}`);

  // Fresh idempotency key per run — each invocation is a distinct manual credit.
  const balance = await addBalance(user.id, amount, `manual:${randomUUID()}`, `admin recharge $${amount}`);

  console.log(`[recharge] +$${amount.toFixed(2)} → ${user.email}`);
  console.log(`[recharge] new balance: $${Number(balance).toFixed(6)}`);
}

main()
  .catch((err) => {
    console.error("[recharge] ❌", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
