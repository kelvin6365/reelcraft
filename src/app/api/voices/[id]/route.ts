// 刪自訂音色。綁咗佢嘅角色會被 SetNull 解除綁定（Prisma onDelete: SetNull），
// 亦即變成「未派音」，配音站個 gate 會即刻叫返用戶重派。
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";

export const DELETE = withAuth(
  async ({ userId, params }) => {
    const row = await prisma.voice.findFirst({ where: { id: params.id, userId } });
    if (!row) throw new ApiError("NOT_FOUND", 404);
    await prisma.voice.delete({ where: { id: row.id } });
    return ok({ removed: true });
  },
  { auditAction: "voice.remove" },
);
