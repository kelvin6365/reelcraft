// User preferences (advanced prompt mode). Single boolean today; the shape
// mirrors src/app/api/user/model-defaults/route.ts so future flags slot in
// the same way.
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ok, fail } from "@/lib/api/errors";
import { audit } from "@/lib/audit";

async function view(userId: string): Promise<{ advancedMode: boolean }> {
  const row = await prisma.userPreferences.findUnique({ where: { userId }, select: { advancedMode: true } });
  return { advancedMode: row?.advancedMode ?? false };
}

export const GET = withAuth(async ({ userId }) => {
  return ok(await view(userId));
});

export const PUT = withAuth(async ({ userId, req }) => {
  const body = (await req.json().catch(() => null)) as { advancedMode?: unknown } | null;
  if (typeof body?.advancedMode !== "boolean") return fail("INVALID_BODY", 400, "expected { advancedMode: boolean }");

  await prisma.userPreferences.upsert({
    where: { userId },
    create: { userId, advancedMode: body.advancedMode },
    update: { advancedMode: body.advancedMode },
  });

  audit(userId, "settings.preferences-set", {
    targetType: "user-preferences",
    targetId: userId,
    metadata: { advancedMode: body.advancedMode },
  });

  return ok(await view(userId));
});
