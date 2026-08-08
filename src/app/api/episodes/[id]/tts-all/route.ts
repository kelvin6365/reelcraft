import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ok } from "@/lib/api/errors";
import { getOwnedEpisode } from "@/lib/api/episode-actions";
import { submitTask } from "@/lib/task/submit";
import { TASK_TYPE } from "@/lib/task/types";
import { filterCastableLines } from "@/lib/voice/castable";

// Fan out TTS_LINE for every voice line still missing audio. Useful for both modes,
// but the primary caller is SRT mode where lines exist without VOICE_ANALYZE.
export const POST = withAuth(
  async ({ userId, params }) => {
    const episode = await getOwnedEpisode(userId, params.id);
    const pending = await prisma.voiceLine.findMany({
      where: { episodeId: episode.id, audioMediaId: null },
      select: { id: true, speaker: true, characterId: true },
    });
    // 未派音色嘅行唔開 task —— 開咗只會即刻 VOICE_NOT_CAST fail
    const lines = await filterCastableLines(episode, pending);
    for (const line of lines) {
      await submitTask({
        userId,
        type: TASK_TYPE.TTS_LINE,
        targetType: "voiceLine",
        targetId: line.id,
        projectId: episode.projectId,
        episodeId: episode.id,
      });
    }
    return ok({ submitted: lines.length, uncast: pending.length - lines.length });
  },
  { auditAction: "episode.tts-all" },
);
