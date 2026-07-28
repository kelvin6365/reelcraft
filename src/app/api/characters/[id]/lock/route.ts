// The ✋ asset review gate: pick one candidate image and lock the character.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { advanceAfterTask } from "@/lib/batch/advance";
import { DEFAULT_CHARACTER_VIEWS } from "@/lib/prompts/character-views";

export const POST = withAuth(
  async ({ userId, params, req }) => {
    const row = await prisma.character.findFirst({ where: { id: params.id, userId } });
    if (!row) throw new ApiError("NOT_FOUND", 404);
    const body = (await req.json()) as { mediaId?: string; unlock?: boolean };
    if (body.unlock) {
      // unlock 唔碰 views — 已生成嘅側面/背面圖唔應該因為解鎖主圖而消失。
      await prisma.character.update({ where: { id: row.id }, data: { locked: false } });
      return ok({ locked: false });
    }
    if (!body.mediaId || !(row.candidates as string[]).includes(body.mediaId)) {
      throw new ApiError("BAD_REQUEST", 400, "mediaId must be one of the candidates");
    }
    const existingViews = (row.views as unknown[] | null) ?? [];
    await prisma.character.update({
      where: { id: row.id },
      data: {
        lockedImageMediaId: body.mediaId,
        locked: true,
        ...(existingViews.length === 0 ? { views: DEFAULT_CHARACTER_VIEWS as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    // 近臉特寫 is user-initiated (the 近臉 button) — no auto-generation on lock.
    // Shot generation tolerates a missing faceImageMediaId (conditional ref).
    // Assets are project-level (shared across episodes) — kick every autorun
    // episode in the project so a lock can unblock a stalled 揀圖 gate.
    const episodes = await prisma.episode.findMany({ where: { projectId: row.projectId, autorun: true }, select: { id: true } });
    for (const e of episodes) advanceAfterTask(e.id);
    return ok({ locked: true });
  },
  { auditAction: "asset.lock" },
);
