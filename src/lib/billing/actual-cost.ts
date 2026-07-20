// Actual cost = provider-billed amount when reported, else our catalog estimate.
// Prisma aggregate can't COALESCE across columns, so sum in two passes: rows with
// a provider-reported cost contribute providerCostUsd, the rest fall back to
// estCostUsd. Media rows (fal/atlascloud report no per-call cost) always land in
// the fallback pass.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function sumActualCostUsd(where: Prisma.AiCallLogWhereInput): Promise<Prisma.Decimal> {
  const [provider, estimated] = await Promise.all([
    prisma.aiCallLog.aggregate({
      where: { ...where, providerCostUsd: { not: null } },
      _sum: { providerCostUsd: true },
    }),
    prisma.aiCallLog.aggregate({
      where: { ...where, providerCostUsd: null },
      _sum: { estCostUsd: true },
    }),
  ]);
  const zero = new Prisma.Decimal(0);
  return (provider._sum.providerCostUsd ?? zero).add(estimated._sum.estCostUsd ?? zero);
}
