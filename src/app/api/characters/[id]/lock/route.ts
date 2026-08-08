// The ✋ asset review gate: pick one candidate image and lock the character.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { advanceAfterTask } from "@/lib/batch/advance";
import { submitTask } from "@/lib/task/submit";
import { TASK_TYPE } from "@/lib/task/types";
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
    // 鎖定即自動生成近臉特寫 —— 推翻 12f6140「改為手動觸發」嘅決定。
    // 理由：實測整個 project 六個角色 faceImageMediaId 全部 NULL，即係手動入口
    // 實際上冇人撳，等於呢個功能唔存在。而近臉圖係身份鎖定最強嘅錨點：
    // 全身圖壓縮之後瞳距 ≈ 30–40px，低過 ISO/IEC 人臉識別最低 90px 一半；
    // 胸像 ≈ 170px。buildShotRefAssets 亦係優先攞 faceImageMediaId 做角色參考圖。
    // 手動「近臉」重生入口（regenerate route 嘅 {face:true} 分支）保留不變。
    if (!row.faceImageMediaId) {
      await submitTask({
        userId,
        type: TASK_TYPE.IMAGE_CHARACTER,
        targetType: "character",
        targetId: row.id,
        projectId: row.projectId,
        payload: { face: true },
        dedupeActive: true,
      });
    }
    // Assets are project-level (shared across episodes) — kick every autorun
    // episode in the project so a lock can unblock a stalled 揀圖 gate.
    const episodes = await prisma.episode.findMany({ where: { projectId: row.projectId, autorun: true }, select: { id: true } });
    for (const e of episodes) advanceAfterTask(e.id);
    return ok({ locked: true });
  },
  { auditAction: "asset.lock" },
);
