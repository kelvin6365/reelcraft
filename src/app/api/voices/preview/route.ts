// 音色試聽 —— 用當前 project 嘅 TTS 模型合成一句短句，畀用戶未派音之前
// 聽下把聲啱唔啱。參考音（refId）唔使合成，佢本身就係嗰把聲，直接回原檔。
//
// 冇做 server-side cache：一次試聽得十幾個字，成本以毫仙計；加一張表／一層
// cache key 嘅複雜度唔值。前端會記住同一個 session 揀過嘅，唔會撳一次收一次。
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { getOwnedProject } from "@/lib/api/project-actions";
import { resolveModelDefaults } from "@/lib/model-defaults/resolve";
import { getCapabilities } from "@/lib/ai/capabilities";
import { generateTts } from "@/lib/ai/generate-media";
import { getMediaUrl } from "@/lib/media/service";
import { checkVoiceMode } from "@/lib/voice/binding";
import { getVoicePreset } from "@/lib/voice/presets";

const SAMPLE_TEXT = "你好，我係呢個角色。呢句係試聽，聽下把聲啱唔啱。";

export const POST = withAuth(
  async ({ userId, req }) => {
    const body = (await req.json()) as { projectId?: unknown; presetId?: unknown; refId?: unknown };
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    if (!projectId) throw new ApiError("BAD_REQUEST", 400, "projectId required");
    const project = await getOwnedProject(userId, projectId);

    // 參考音：本身就係音源，唔使燒錢再合成一次
    if (typeof body.refId === "string" && body.refId) {
      const voice = await prisma.voice.findFirst({ where: { id: body.refId, userId, projectId } });
      if (!voice) throw new ApiError("NOT_FOUND", 404, "參考音搵唔到");
      return ok({ audioUrl: await getMediaUrl(voice.audioMediaId), synthesized: false });
    }

    const presetId = typeof body.presetId === "string" ? body.presetId : "";
    const preset = presetId ? getVoicePreset(presetId) : null;
    if (!preset) throw new ApiError("BAD_REQUEST", 400, "presetId 或 refId 至少要有一個（而且要喺音色庫）");

    const models = await resolveModelDefaults(userId, project);
    const binding = { kind: "preset" as const, presetId, vendor: preset.vendor };
    const modeCheck = checkVoiceMode(binding, getCapabilities(models.tts) ?? null, models.tts);
    if (!modeCheck.ok) throw new ApiError("BAD_REQUEST", 400, modeCheck.message);

    const media = await generateTts(
      { userId, projectId: project.id },
      {
        modelKey: models.tts,
        text: SAMPLE_TEXT,
        voice: binding,
        keyPrefix: `projects/${project.id}/voice-previews/${presetId}`,
      },
    );
    return ok({ audioUrl: await getMediaUrl(media.id), synthesized: true });
  },
  { auditAction: "voice.preview" },
);
