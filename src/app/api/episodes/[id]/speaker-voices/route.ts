// 非角色 speaker 嘅音色 —— 旁白／【機械音】／【系統】／「未知」冇 Character
// 可綁，所以綁喺集身上。一次改一個 speaker。
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { getOwnedEpisode } from "@/lib/api/episode-actions";
import { parseSpeakerVoices } from "@/lib/voice/binding";
import { invalidateSpeakerAudio, validateVoicePatch } from "@/lib/voice/assign";

export const PUT = withAuth(
  async ({ userId, params, req }) => {
    const episode = await getOwnedEpisode(userId, params.id);
    const body = (await req.json()) as { speaker?: unknown; presetId?: unknown; refId?: unknown };
    const speaker = typeof body.speaker === "string" ? body.speaker.trim() : "";
    if (!speaker) throw new ApiError("BAD_REQUEST", 400, "speaker required");

    const patch = await validateVoicePatch(userId, episode.projectId, body);
    const map = parseSpeakerVoices(episode.speakerVoices);
    const before = JSON.stringify(map[speaker] ?? null);

    if (patch.presetId) map[speaker] = { presetId: patch.presetId };
    else if (patch.refId) map[speaker] = { refId: patch.refId };
    else delete map[speaker];

    await prisma.episode.update({
      where: { id: episode.id },
      data: { speakerVoices: map as unknown as Prisma.InputJsonValue },
    });

    const changed = before !== JSON.stringify(map[speaker] ?? null);
    const invalidated = changed ? await invalidateSpeakerAudio(episode.id, speaker) : 0;
    return ok({ speaker, ...patch, invalidatedLines: invalidated });
  },
  { auditAction: "episode.speaker-voice.assign" },
);
