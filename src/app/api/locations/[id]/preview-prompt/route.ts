// Dry-run preview of the exact prompt that WOULD be sent to generateImage()
// for this location, given the caller's (possibly unsaved) draft fields —
// reuses the same pure builders the real generation handler calls
// (location-angles.ts), so preview and reality can never drift apart. No AI
// call, no assertWithinBudget, no quota — pure computation only.
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { loadStyle } from "@/lib/prompts/style-pack";
import { buildAngleImagePrompt, buildAngleNegativePrompt, buildLocationMainPrompt } from "@/lib/prompts/location-angles";

export const POST = withAuth(
  async ({ userId, params, req }) => {
    const location = await prisma.location.findFirst({ where: { id: params.id, userId } });
    if (!location) throw new ApiError("NOT_FOUND", 404);
    const body = (await req.json().catch(() => ({}))) as {
      prompt?: string;
      view?: { label: string; prompt: string };
    };

    const project = await prisma.project.findUniqueOrThrow({ where: { id: location.projectId } });
    const style = await loadStyle(project.stylePackId);
    const basePrompt = typeof body.prompt === "string" ? body.prompt : location.prompt;

    if (body.view) {
      return ok({
        viewPrompt: buildAngleImagePrompt(basePrompt, body.view, style),
        negativePrompt: buildAngleNegativePrompt(style),
      });
    }

    return ok({
      mainPrompt: buildLocationMainPrompt(basePrompt, style),
      negativePrompt: buildAngleNegativePrompt(style),
    });
  },
  { auditAction: "location.preview-prompt" },
);
