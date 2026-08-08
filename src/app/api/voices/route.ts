// 自訂音色（參考音）—— 上傳一段人聲，之後 TTS 用佢做聲音克隆嘅參考。
// project-level，同 Character/Location 一樣跨集複用。
import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { getOwnedProject } from "@/lib/api/project-actions";
import { createMediaFromBuffer, getMediaUrl } from "@/lib/media/service";

const ALLOWED_MIME = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/webm", "audio/ogg"]);
const MAX_BYTES = 20 * 1024 * 1024;

export const GET = withAuth(async ({ userId, req }) => {
  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  if (!projectId) throw new ApiError("BAD_REQUEST", 400, "projectId required");
  await getOwnedProject(userId, projectId);
  const rows = await prisma.voice.findMany({ where: { projectId, userId }, orderBy: { createdAt: "asc" } });
  return ok({
    voices: await Promise.all(
      rows.map(async (v) => ({ id: v.id, name: v.name, note: v.note, audioUrl: await getMediaUrl(v.audioMediaId) })),
    ),
  });
});

export const POST = withAuth(
  async ({ userId, req }) => {
    const form = await req.formData();
    const projectId = String(form.get("projectId") ?? "");
    const name = String(form.get("name") ?? "").trim().slice(0, 60);
    const file = form.get("file");
    if (!projectId) throw new ApiError("BAD_REQUEST", 400, "projectId required");
    if (!name) throw new ApiError("BAD_REQUEST", 400, "音色名唔可以空");
    if (!(file instanceof File)) throw new ApiError("BAD_REQUEST", 400, "file required");
    if (!ALLOWED_MIME.has(file.type)) throw new ApiError("BAD_REQUEST", 400, "只接受 mp3／wav／m4a／ogg 音檔");
    if (file.size > MAX_BYTES) throw new ApiError("BAD_REQUEST", 400, "檔案不可超過 20MB");

    const project = await getOwnedProject(userId, projectId);
    const media = await createMediaFromBuffer({
      userId,
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type,
      keyPrefix: `projects/${project.id}/voices`,
    });
    const voice = await prisma.voice.create({
      data: {
        id: newId(),
        userId,
        projectId: project.id,
        name,
        audioMediaId: media.id,
        note: String(form.get("note") ?? "").slice(0, 300),
      },
    });
    return ok({ id: voice.id, name: voice.name, audioUrl: await getMediaUrl(media.id) });
  },
  { auditAction: "voice.upload" },
);
