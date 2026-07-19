// User model-defaults (the "user" layer of the 3-layer resolver, design doc
// 2026-07-19-provider-model-defaults). GET returns the caller's stored slots
// alongside the fully-resolved effective models and the system floor, so the
// settings UI can show "(系統預設)" placeholders. PUT validates + merges a patch
// ("" clears a slot → the key is DELETED, never stored empty) and upserts.
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ok, fail } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import {
  resolveModelDefaults,
  validateDefaultsPatch,
  effectiveSystemDefaults,
  type ModelDefaults,
} from "@/lib/model-defaults/resolve";
import { mergeUserDefaults } from "@/lib/user/model-defaults";

async function readDefaults(userId: string): Promise<Partial<ModelDefaults>> {
  const row = await prisma.userModelDefaults.findUnique({ where: { userId }, select: { defaults: true } });
  return (row?.defaults ?? {}) as Partial<ModelDefaults>;
}

async function view(userId: string) {
  const [defaults, resolved] = await Promise.all([readDefaults(userId), resolveModelDefaults(userId, null)]);
  return { defaults, resolved, system: effectiveSystemDefaults() };
}

export const GET = withAuth(async ({ userId }) => {
  return ok(await view(userId));
});

export const PUT = withAuth(async ({ userId, req }) => {
  const body = (await req.json().catch(() => null)) as { defaults?: unknown } | null;
  if (typeof body !== "object" || body === null) return fail("INVALID_BODY", 400, "expected an object");

  const parsed = validateDefaultsPatch(body.defaults);
  if (!parsed.ok) return fail(parsed.error.code, 400, parsed.error.message);

  const existing = await readDefaults(userId);
  const merged = mergeUserDefaults(existing, parsed.value);

  await prisma.userModelDefaults.upsert({
    where: { userId },
    create: { userId, defaults: merged as object },
    update: { defaults: merged as object },
  });

  // Record which slots were touched — model keys only, never any key material.
  audit(userId, "settings.model-defaults-set", {
    targetType: "user-model-defaults",
    targetId: userId,
    metadata: { modelKeys: parsed.value },
  });

  return ok(await view(userId));
});
