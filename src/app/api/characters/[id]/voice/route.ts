// 角色派音 —— 綁 provider 內置音色（presetId）或者上傳嘅參考音（refId）。
// 兩個都唔畀 = 解除綁定。換音色會作廢該角色已生成嘅配音（見 assign.ts）。
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { invalidateCharacterAudio, validateVoicePatch } from "@/lib/voice/assign";

export const PUT = withAuth(
  async ({ userId, params, req }) => {
    const row = await prisma.character.findFirst({ where: { id: params.id, userId } });
    if (!row) throw new ApiError("NOT_FOUND", 404);

    const body = (await req.json()) as { presetId?: unknown; refId?: unknown; note?: unknown };
    const patch = await validateVoicePatch(userId, row.projectId, body);

    const unchanged = row.voicePresetId === patch.presetId && row.voiceRefId === patch.refId;
    await prisma.character.update({
      where: { id: row.id },
      data: {
        voicePresetId: patch.presetId,
        voiceRefId: patch.refId,
        voiceCastNote: typeof body.note === "string" ? body.note.slice(0, 300) : "",
      },
    });

    const invalidated = unchanged ? 0 : await invalidateCharacterAudio(row.id);
    return ok({ voicePresetId: patch.presetId, voiceRefId: patch.refId, invalidatedLines: invalidated });
  },
  { auditAction: "character.voice.assign" },
);
