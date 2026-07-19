// GET /api/models — the provider + model catalog for pickers (design doc
// 2026-07-19-provider-model-defaults). Returns provider connection status
// (user-key / env-key / none — PRESENCE only, never key material, never a live
// ping) and the model catalog with unit prices. Optional ?projectId= (must
// belong to the caller) adds that project's generated-image count so the picker
// can soft-warn before switching image models.
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { PROVIDERS } from "@/lib/providers";
import { listCapabilityEntries } from "@/lib/ai/capabilities";
import { buildProvidersView, buildModelsView } from "@/lib/models/catalog-view";
import { envKeyProviders, isProduction } from "@/lib/providers-env";

export const GET = withAuth(async ({ userId, req }) => {
  const includeDevOnly = !isProduction();

  const userKeyRows = await prisma.userProviderKey.findMany({ where: { userId }, select: { provider: true } });
  const userKeyProviders = new Set(userKeyRows.map((r) => r.provider));

  const providers = buildProvidersView({
    providers: PROVIDERS,
    userKeyProviders,
    envKeyProviders: envKeyProviders(),
    includeDevOnly,
  });
  const models = buildModelsView(listCapabilityEntries(), includeDevOnly);

  // Optional per-project context: how many shots already have a generated image.
  // Character/location locked images are excluded — shot images are the count the
  // "switching image model" warning cares about, and it's a single cheap query.
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (projectId) {
    const project = await prisma.project.findFirst({ where: { id: projectId, userId }, select: { id: true } });
    if (!project) throw new ApiError("NOT_FOUND", 404);
    const generatedImageCount = await prisma.shot.count({
      where: { userId, episode: { projectId: project.id }, imageMediaId: { not: null } },
    });
    return ok({ providers, models, generatedImageCount });
  }

  return ok({ providers, models });
});
