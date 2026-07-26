// Edit a character's generation prompt (資產提示詞可改 — regen uses the edit).
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";

export const PATCH = withAuth(
  async ({ userId, params, req }) => {
    const row = await prisma.character.findFirst({ where: { id: params.id, userId } });
    if (!row) throw new ApiError("NOT_FOUND", 404);
    const body = (await req.json()) as { appearancePrompt?: string; refFaceNote?: string };
    if (typeof body.appearancePrompt !== "string" && typeof body.refFaceNote !== "string") {
      throw new ApiError("BAD_REQUEST", 400, "appearancePrompt 或 refFaceNote 至少提供一個");
    }
    await prisma.character.update({
      where: { id: row.id },
      data: {
        ...(typeof body.appearancePrompt === "string" ? { appearancePrompt: body.appearancePrompt.slice(0, 2000) } : {}),
        ...(typeof body.refFaceNote === "string" ? { refFaceNote: body.refFaceNote.slice(0, 500) } : {}),
      },
    });
    return ok({ updated: true });
  },
  { auditAction: "asset.edit" },
);
