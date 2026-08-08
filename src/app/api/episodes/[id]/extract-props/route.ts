// Independent from extract-assets — retry isolation (see docs/plans design).
// Optional body.targetName switches the prompt into "manual補抽" focus mode:
// the AI re-scans the full script hunting for that one prop instead of doing
// a full importance-ranked pass (see extractPropsHandler).
import { withAuth } from "@/lib/api/with-auth";
import { ok } from "@/lib/api/errors";
import { getOwnedEpisode, submitEpisodeTask } from "@/lib/api/episode-actions";
import { TASK_TYPE } from "@/lib/task/types";

export const POST = withAuth(
  async ({ userId, params, req }) => {
    const episode = await getOwnedEpisode(userId, params.id);
    const body = (await req.json().catch(() => ({}))) as { targetName?: string };
    const targetName = typeof body.targetName === "string" ? body.targetName.slice(0, 100) : undefined;
    return ok(await submitEpisodeTask(userId, episode, TASK_TYPE.EXTRACT_PROPS, { targetName, at: Date.now() }));
  },
  { auditAction: "episode.extract-props" },
);
