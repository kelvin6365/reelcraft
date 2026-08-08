// Dry-run preview of the exact prompt that WOULD be sent to generateImage()/
// generateVideo() for this prop, given the caller's (possibly unsaved) draft
// fields — reuses the same pure builders the real generation handler calls
// (prop-views.ts), so preview and reality can never drift apart. No AI call,
// no assertWithinBudget, no quota — pure computation only.
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { loadStyle } from "@/lib/prompts/style-pack";
import { buildPropMainPrompt, buildPropViewPrompt, buildPropNegativePrompt, type PropTier } from "@/lib/prompts/prop-views";

export const POST = withAuth(
  async ({ userId, params, req }) => {
    const prop = await prisma.prop.findFirst({ where: { id: params.id, userId } });
    if (!prop) throw new ApiError("NOT_FOUND", 404);
    const body = (await req.json().catch(() => ({}))) as {
      material?: string;
      dimensions?: string;
      prompt?: string;
      physicalParams?: string;
      view?: { label: string; prompt: string };
      effectVideo?: boolean;
    };

    const project = await prisma.project.findUniqueOrThrow({ where: { id: prop.projectId } });
    const style = await loadStyle(project.stylePackId);
    const tier = prop.tier as PropTier;
    const basePrompt = typeof body.prompt === "string" ? body.prompt : prop.prompt;

    if (body.effectVideo) {
      const physicalParams = typeof body.physicalParams === "string" ? body.physicalParams : prop.physicalParams;
      const videoPrompt = [basePrompt, physicalParams].filter(Boolean).join(". ").trim();
      return ok({ videoPrompt });
    }

    if (body.view) {
      return ok({
        viewPrompt: buildPropViewPrompt(basePrompt, body.view, tier, style),
        negativePrompt: buildPropNegativePrompt(style),
      });
    }

    const sceneRef =
      tier === "scene" && prop.locationId
        ? await prisma.location.findFirst({ where: { id: prop.locationId }, select: { name: true, lockedImageMediaId: true } })
        : null;

    return ok({
      mainPrompt: buildPropMainPrompt(
        basePrompt,
        typeof body.material === "string" ? body.material : prop.material,
        typeof body.dimensions === "string" ? body.dimensions : prop.dimensions,
        tier,
        style,
      ),
      negativePrompt: buildPropNegativePrompt(style),
      sceneRefName: sceneRef?.lockedImageMediaId ? sceneRef.name : null,
    });
  },
  { auditAction: "prop.preview-prompt" },
);
