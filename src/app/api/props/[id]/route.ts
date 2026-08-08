// Edit a prop's generation prompt/material/dimensions, or one view's label/prompt.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";

interface PropView {
  label: string;
  prompt: string;
  mediaId: string | null;
}

export const PATCH = withAuth(
  async ({ userId, params, req }) => {
    const row = await prisma.prop.findFirst({ where: { id: params.id, userId } });
    if (!row) throw new ApiError("NOT_FOUND", 404);
    const body = (await req.json()) as {
      prompt?: string;
      material?: string;
      dimensions?: string;
      physicalParams?: string;
      viewIndex?: number;
      viewPrompt?: string;
      viewLabel?: string;
    };

    const hasPrompt = typeof body.prompt === "string";
    const hasMaterial = typeof body.material === "string";
    const hasDimensions = typeof body.dimensions === "string";
    const hasPhysicalParams = typeof body.physicalParams === "string";
    const hasViewEdit = typeof body.viewIndex === "number";
    if (!hasPrompt && !hasMaterial && !hasDimensions && !hasPhysicalParams && !hasViewEdit) {
      throw new ApiError("BAD_REQUEST", 400, "prompt, material, dimensions, physicalParams or viewIndex required");
    }

    if (hasViewEdit) {
      const views = (row.views as PropView[] | null) ?? [];
      const idx = body.viewIndex as number;
      if (!Number.isInteger(idx) || idx < 0 || idx >= views.length) {
        throw new ApiError("BAD_REQUEST", 400, "viewIndex out of range");
      }
      // mediaId 唔可以由 client 寫——Json 冇 FK，接受 client 提供嘅 mediaId 會俾一個用戶指向另一個用戶嘅 media
      const next = views.map((v, i) =>
        i === idx
          ? {
              label: typeof body.viewLabel === "string" ? body.viewLabel.slice(0, 100) : v.label,
              prompt: typeof body.viewPrompt === "string" ? body.viewPrompt.slice(0, 2000) : v.prompt,
              mediaId: v.mediaId,
            }
          : v,
      );
      await prisma.prop.update({ where: { id: row.id }, data: { views: next as unknown as Prisma.InputJsonValue } });
    }

    const data: Prisma.PropUpdateInput = {};
    if (hasPrompt) data.prompt = (body.prompt as string).slice(0, 2000);
    if (hasMaterial) data.material = (body.material as string).slice(0, 200);
    if (hasDimensions) data.dimensions = (body.dimensions as string).slice(0, 200);
    if (hasPhysicalParams) data.physicalParams = (body.physicalParams as string).slice(0, 500);
    if (Object.keys(data).length > 0) {
      await prisma.prop.update({ where: { id: row.id }, data });
    }

    return ok({ updated: true });
  },
  { auditAction: "asset.edit" },
);

// 刪除道具資產。道具係三種資產入面唯一可以「抽多咗」嘅一種——角色同場景由劇本結構決定，
// 道具係判斷題（服裝被當成道具、抽象效果、重複命名），所以要有得刪。
//
// 唔連帶刪 MediaObject：媒體係 content-addressed（sha256）並且可以被其他資產共用，
// 由 storage GC 統一處理，喺呢度刪會刪咗人哋嗰份。Shot 唔會 FK 指向 Prop
// （道具係經 keyProps 名字匹配入鏡，見 matchShotProps），所以刪走唔會孤兒化任何鏡頭。
export const DELETE = withAuth(
  async ({ userId, params }) => {
    const row = await prisma.prop.findFirst({ where: { id: params.id, userId }, select: { id: true } });
    if (!row) throw new ApiError("NOT_FOUND", 404);
    await prisma.prop.delete({ where: { id: row.id } });
    return ok({ deleted: true });
  },
  { auditAction: "asset.delete" },
);
