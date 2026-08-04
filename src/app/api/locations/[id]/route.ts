// Edit a location's generation prompt (資產提示詞可改 — regen uses the edit),
// or edit one AI-suggested angle's label/prompt (extract_locations).
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";

interface LocationAngle {
  label: string;
  prompt: string;
  mediaId: string | null;
}

export const PATCH = withAuth(
  async ({ userId, params, req }) => {
    const row = await prisma.location.findFirst({ where: { id: params.id, userId } });
    if (!row) throw new ApiError("NOT_FOUND", 404);
    const body = (await req.json()) as {
      prompt?: string;
      angleIndex?: number;
      anglePrompt?: string;
      angleLabel?: string;
    };

    const hasPrompt = typeof body.prompt === "string";
    const hasAngleEdit = typeof body.angleIndex === "number";
    if (!hasPrompt && !hasAngleEdit) throw new ApiError("BAD_REQUEST", 400, "prompt or angleIndex required");

    if (hasAngleEdit) {
      const angles = (row.angles as LocationAngle[] | null) ?? [];
      const idx = body.angleIndex as number;
      if (!Number.isInteger(idx) || idx < 0 || idx >= angles.length) {
        throw new ApiError("BAD_REQUEST", 400, "angleIndex out of range");
      }
      // mediaId is never client-writable here — Json has no FK, so accepting a
      // client-supplied mediaId would let one user point an angle at another
      // user's media. Keep the existing row value; PR3's angle-generation
      // handler is the only writer of mediaId.
      const next = angles.map((a, i) =>
        i === idx
          ? {
              label: typeof body.angleLabel === "string" ? body.angleLabel.slice(0, 100) : a.label,
              prompt: typeof body.anglePrompt === "string" ? body.anglePrompt.slice(0, 2000) : a.prompt,
              mediaId: a.mediaId,
            }
          : a,
      );
      await prisma.location.update({
        where: { id: row.id },
        data: { angles: next as unknown as Prisma.InputJsonValue },
      });
    }

    if (hasPrompt) {
      await prisma.location.update({
        where: { id: row.id },
        data: { prompt: (body.prompt as string).slice(0, 2000) },
      });
    }

    return ok({ updated: true });
  },
  { auditAction: "asset.edit" },
);
