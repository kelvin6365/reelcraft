import { withAuth } from "@/lib/api/with-auth";
import { ok } from "@/lib/api/errors";
import { getOwnedEpisode } from "@/lib/api/episode-actions";
import { parseLineIds, submitVoiceLineBatch } from "@/lib/api/voice-batch";

// 配音批量提交。冇 body → 補配所有未有音檔嘅行（一鍵配音／SRT 路線）；
// 有 lineIds → 重配呢批（唔理有冇音檔），即係配音站個批量重配。
// 空台詞同未派音色嘅行會被剔走，唔會排一堆注定失敗嘅 task 出嚟。
export const POST = withAuth(
  async ({ userId, params, req }) => {
    const episode = await getOwnedEpisode(userId, params.id);
    const lineIds = parseLineIds(await req.json().catch(() => null));
    return ok(await submitVoiceLineBatch({ userId, episode, lineIds }));
  },
  { auditAction: "episode.tts-all" },
);
