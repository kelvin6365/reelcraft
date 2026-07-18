import { withAuth } from "@/lib/api/with-auth";
import { ok } from "@/lib/api/errors";
import { getOwnedEpisode, submitEpisodeTask } from "@/lib/api/episode-actions";
import { TASK_TYPE } from "@/lib/task/types";

// SRT input mode (M2-T3): parse the pasted subtitle rawText into scene/shots/voice-lines.
export const POST = withAuth(
  async ({ userId, params }) => {
    const episode = await getOwnedEpisode(userId, params.id);
    return ok(await submitEpisodeTask(userId, episode, TASK_TYPE.SRT_BUILD, { at: Date.now() }));
  },
  { auditAction: "episode.srt-build" },
);
