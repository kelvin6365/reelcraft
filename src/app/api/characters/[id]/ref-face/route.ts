// 墊臉 — upload/remove a character's reference face image. Fed into
// generateImage() as an extra reference (see assetImageHandler in
// media-handlers.ts) so candidate generations lock onto this face.
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { createMediaFromBuffer } from "@/lib/media/service";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 10 * 1024 * 1024;

export const POST = withAuth(
  async ({ userId, params, req }) => {
    const row = await prisma.character.findFirst({ where: { id: params.id, userId } });
    if (!row) throw new ApiError("NOT_FOUND", 404);

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError("BAD_REQUEST", 400, "file required");
    if (!ALLOWED_MIME.has(file.type)) throw new ApiError("BAD_REQUEST", 400, "只接受 jpeg/png/webp 圖片");
    if (file.size > MAX_BYTES) throw new ApiError("BAD_REQUEST", 400, "檔案不可超過 10MB");

    const buffer = Buffer.from(await file.arrayBuffer());
    const media = await createMediaFromBuffer({
      userId,
      buffer,
      mimeType: file.type,
      keyPrefix: `projects/${row.projectId}/characters/${row.id}/ref-face`,
    });

    await prisma.character.update({ where: { id: row.id }, data: { refFaceMediaId: media.id } });
    return ok({ refFaceMediaId: media.id });
  },
  { auditAction: "character.refface.upload" },
);

export const DELETE = withAuth(
  async ({ userId, params }) => {
    const row = await prisma.character.findFirst({ where: { id: params.id, userId } });
    if (!row) throw new ApiError("NOT_FOUND", 404);

    await prisma.character.update({ where: { id: row.id }, data: { refFaceMediaId: null } });
    return ok({ removed: true });
  },
  { auditAction: "character.refface.remove" },
);
