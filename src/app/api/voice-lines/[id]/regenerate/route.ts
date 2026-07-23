import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { submitTask } from "@/lib/task/submit";
import { TASK_TYPE } from "@/lib/task/types";

// Re-synthesize a single line after editing it — the per-line half of the voice
// station's editability. dedupeActive collapses a double-click onto the running
// task instead of paying for TTS twice.
export const POST = withAuth(
  async ({ userId, params }) => {
    const line = await prisma.voiceLine.findFirst({
      where: { id: params.id, userId },
      select: { id: true, content: true, episodeId: true, episode: { select: { projectId: true } } },
    });
    if (!line) throw new ApiError("NOT_FOUND", 404);
    // Don't spend TTS on an empty line — it would just fail at the worker after
    // reserving quota.
    if (line.content.trim().length === 0) throw new ApiError("EMPTY_LINE", 400, "台詞係空，冇嘢可以配音");
    const res = await submitTask({
      userId,
      type: TASK_TYPE.TTS_LINE,
      targetType: "voiceLine",
      targetId: line.id,
      projectId: line.episode.projectId,
      episodeId: line.episodeId,
      payload: { at: Date.now() },
      dedupeActive: true,
    });
    return ok(res);
  },
  { auditAction: "voice-line.regenerate" },
);
