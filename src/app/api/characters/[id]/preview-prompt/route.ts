// Dry-run preview of the exact prompt that WOULD be sent to generateImage()
// for this character, given the caller's (possibly unsaved) draft fields —
// reuses the same pure builders the real generation handler calls
// (character-views.ts), so preview and reality can never drift apart. No AI
// call, no assertWithinBudget, no quota — pure computation only.
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { loadStyle } from "@/lib/prompts/style-pack";
import {
  buildCharacterMainPrompt,
  buildCharacterViewPrompt,
  buildCharacterNegativePrompt,
  buildCharacterFacePrompt,
  REF_FACE_MATCH_PROMPT,
} from "@/lib/prompts/character-views";

export const POST = withAuth(
  async ({ userId, params, req }) => {
    const character = await prisma.character.findFirst({ where: { id: params.id, userId } });
    if (!character) throw new ApiError("NOT_FOUND", 404);
    const body = (await req.json().catch(() => ({}))) as {
      prompt?: string;
      refFaceNote?: string;
      view?: { label: string; prompt: string };
      face?: boolean;
    };

    const project = await prisma.project.findUniqueOrThrow({ where: { id: character.projectId } });
    const style = await loadStyle(project.stylePackId);
    const basePrompt = typeof body.prompt === "string" ? body.prompt : character.appearancePrompt;

    if (body.face) {
      return ok({
        facePrompt: buildCharacterFacePrompt(basePrompt, style),
        negativePrompt: style.negativePrompt ?? "",
      });
    }

    if (body.view) {
      return ok({
        viewPrompt: buildCharacterViewPrompt(basePrompt, body.view, style),
        negativePrompt: buildCharacterNegativePrompt(style),
      });
    }

    const hasRefFace = !!character.refFaceMediaId;
    const refFaceNote = typeof body.refFaceNote === "string" ? body.refFaceNote : character.refFaceNote;
    const extra = [hasRefFace ? REF_FACE_MATCH_PROMPT : "", refFaceNote].filter(Boolean);

    return ok({
      mainPrompt: buildCharacterMainPrompt(basePrompt, style, extra),
      negativePrompt: style.negativePrompt ?? "",
      hasRefFace,
    });
  },
  { auditAction: "character.preview-prompt" },
);
