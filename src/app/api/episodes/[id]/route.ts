import { withAuth } from "@/lib/api/with-auth";
import { ok } from "@/lib/api/errors";
import { buildEpisodeView } from "@/lib/api/episode-snapshot";

export const GET = withAuth(async ({ userId, params }) => {
  return ok(await buildEpisodeView(userId, params.id));
});
