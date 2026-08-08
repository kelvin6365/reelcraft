// AI 派音 —— 由音色庫幫每個聲源揀一把聲。純 text call，唔會生成任何音頻，
// 所以唔使錢閘；用戶之後可以逐個改。
import { withAuth } from "@/lib/api/with-auth";
import { ok } from "@/lib/api/errors";
import { getOwnedEpisode, submitEpisodeTask } from "@/lib/api/episode-actions";
import { TASK_TYPE } from "@/lib/task/types";

export const POST = withAuth(
  async ({ userId, params }) => {
    const episode = await getOwnedEpisode(userId, params.id);
    return ok(await submitEpisodeTask(userId, episode, TASK_TYPE.VOICE_CAST, { at: Date.now() }));
  },
  { auditAction: "episode.voice-cast" },
);
