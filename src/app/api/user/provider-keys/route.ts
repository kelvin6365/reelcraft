// BYO provider keys (M3-T2). GET lists the caller's stored keys as
// {provider, last4, updatedAt} — NEVER the plaintext or the envelope (rule #5).
// PUT upserts an encrypted key; DELETE removes one. Audit metadata records the
// provider only — the key material must never reach a log or an AuditLog row.
import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { withAuth } from "@/lib/api/with-auth";
import { ok, fail } from "@/lib/api/errors";
import { encryptKey, last4 } from "@/lib/crypto-keys";
import { parsePutBody, parseProviderField, toProviderKeyView } from "@/lib/user/provider-keys";

export const GET = withAuth(async ({ userId }) => {
  const rows = await prisma.userProviderKey.findMany({
    where: { userId },
    select: { provider: true, last4: true, updatedAt: true },
    orderBy: { provider: "asc" },
  });
  return ok({ keys: rows.map(toProviderKeyView) });
});

export const PUT = withAuth(async ({ userId, req }) => {
  const parsed = parsePutBody(await req.json().catch(() => null));
  if (!parsed.ok) return fail(parsed.error.code, 400, parsed.error.message);
  const { provider, apiKey } = parsed.value;

  const encryptedKey = encryptKey(apiKey);
  const suffix = last4(apiKey);
  await prisma.userProviderKey.upsert({
    where: { userId_provider: { userId, provider } },
    create: { id: newId(), userId, provider, encryptedKey, last4: suffix },
    update: { encryptedKey, last4: suffix },
  });

  // provider only — never the key.
  audit(userId, "settings.key-set", { targetType: "provider-key", targetId: provider, metadata: { provider } });
  return ok({ provider, last4: suffix });
});

export const DELETE = withAuth(async ({ userId, req }) => {
  const parsed = parseProviderField(await req.json().catch(() => null));
  if (!parsed.ok) return fail(parsed.error.code, 400, parsed.error.message);
  const { provider } = parsed;

  await prisma.userProviderKey.deleteMany({ where: { userId, provider } });
  audit(userId, "settings.key-delete", { targetType: "provider-key", targetId: provider, metadata: { provider } });
  return ok({ provider });
});
