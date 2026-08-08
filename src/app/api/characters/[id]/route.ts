// Edit a character's generation prompt (資產提示詞可改 — regen uses the edit),
// or edit one 側面/背面 view's label/prompt (mirrors locations PATCH).
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";

interface CharacterView {
  label: string;
  prompt: string;
  mediaId: string | null;
}

export const PATCH = withAuth(
  async ({ userId, params, req }) => {
    const row = await prisma.character.findFirst({ where: { id: params.id, userId } });
    if (!row) throw new ApiError("NOT_FOUND", 404);
    const body = (await req.json()) as {
      appearancePrompt?: string;
      refFaceNote?: string;
      viewIndex?: number;
      viewPrompt?: string;
      viewLabel?: string;
    };

    const hasFieldEdit = typeof body.appearancePrompt === "string" || typeof body.refFaceNote === "string";
    const hasViewEdit = typeof body.viewIndex === "number";
    if (!hasFieldEdit && !hasViewEdit) {
      throw new ApiError("BAD_REQUEST", 400, "appearancePrompt、refFaceNote 或 viewIndex 至少提供一個");
    }

    if (hasViewEdit) {
      const views = (row.views as CharacterView[] | null) ?? [];
      const idx = body.viewIndex as number;
      if (!Number.isInteger(idx) || idx < 0 || idx >= views.length) {
        throw new ApiError("BAD_REQUEST", 400, "viewIndex out of range");
      }
      // mediaId is never client-writable here — Json has no FK, so accepting a
      // client-supplied mediaId would let one user point a view at another
      // user's media. Keep the existing row value; the IMAGE_CHARACTER view
      // handler is the only writer of mediaId.
      const next = views.map((v, i) =>
        i === idx
          ? {
              label: typeof body.viewLabel === "string" ? body.viewLabel.slice(0, 100) : v.label,
              prompt: typeof body.viewPrompt === "string" ? body.viewPrompt.slice(0, 2000) : v.prompt,
              mediaId: v.mediaId,
            }
          : v,
      );
      await prisma.character.update({
        where: { id: row.id },
        data: { views: next as unknown as Prisma.InputJsonValue },
      });
    }

    if (hasFieldEdit) {
      await prisma.character.update({
        where: { id: row.id },
        data: {
          ...(typeof body.appearancePrompt === "string" ? { appearancePrompt: body.appearancePrompt.slice(0, 2000) } : {}),
          ...(typeof body.refFaceNote === "string" ? { refFaceNote: body.refFaceNote.slice(0, 500) } : {}),
        },
      });
    }

    return ok({ updated: true });
  },
  { auditAction: "asset.edit" },
);
