// The ✋ storyboard review gate: advancing status past "storyboard" unlocks images.
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { getOwnedEpisode } from "@/lib/api/episode-actions";
import { advanceAfterTask } from "@/lib/batch/advance";

export const POST = withAuth(
  async ({ userId, params, req }) => {
    const episode = await getOwnedEpisode(userId, params.id);
    const shots = await prisma.shot.count({ where: { episodeId: episode.id } });
    if (shots === 0) throw new ApiError("NO_SHOTS", 400, "generate the storyboard first");
    const body = (await req.json().catch(() => ({}))) as { authorizeDownstream?: boolean };
    const cfg = (episode.autorunConfig ?? {}) as { mode?: "batch" | "assisted"; moneyAuthorized?: boolean };
    const authorize = Boolean(body.authorizeDownstream) && episode.autorun && cfg.mode === "assisted";
    await prisma.episode.update({
      where: { id: episode.id },
      data: {
        status: "images",
        ...(authorize ? { autorunConfig: { ...cfg, moneyAuthorized: true } } : {}),
      },
    });
    advanceAfterTask(episode.id); // confirm isn't a task completion — kick the chain manually (no-op if not autorun)
    return ok({ confirmed: true, shots, authorizeDownstream: authorize });
  },
  { auditAction: "storyboard.confirm" },
);
