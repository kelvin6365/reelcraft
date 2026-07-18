// Resolve a MediaObject id to a fresh signed URL (used for candidate grids etc.).
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { getStorage } from "@/lib/storage";

export const GET = withAuth(async ({ userId, params }) => {
  const media = await prisma.mediaObject.findFirst({ where: { id: params.id, userId } });
  if (!media) throw new ApiError("NOT_FOUND", 404);
  const url = await getStorage().getSignedUrl(media.storageKey, 3600);
  return ok({ url, mimeType: media.mimeType });
});
