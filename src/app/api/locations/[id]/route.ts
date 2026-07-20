// Edit a location's generation prompt (資產提示詞可改 — regen uses the edit).
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";

export const PATCH = withAuth(
  async ({ userId, params, req }) => {
    const row = await prisma.location.findFirst({ where: { id: params.id, userId } });
    if (!row) throw new ApiError("NOT_FOUND", 404);
    const body = (await req.json()) as { prompt?: string };
    if (typeof body.prompt !== "string") throw new ApiError("BAD_REQUEST", 400, "prompt required");
    await prisma.location.update({
      where: { id: row.id },
      data: { prompt: body.prompt.slice(0, 2000) },
    });
    return ok({ updated: true });
  },
  { auditAction: "asset.edit" },
);
