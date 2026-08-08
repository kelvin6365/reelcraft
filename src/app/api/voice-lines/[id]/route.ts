import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";

// The three lineTypes the analyzer emits (schema comment on VoiceLine.lineType).
// Anything else is dropped rather than persisted as free text that would confuse
// the compose/subtitle path.
const LINE_TYPES = new Set(["dialogue", "vo", "os"]);

// Edit one dialogue line. The voice station was the only generation station with
// no editing at all, so a mis-attributed line (火豹 #85「配角說了主角的話」) or a
// wrong word could not be fixed without re-running the whole analysis and losing
// every clip. Changing `speaker` re-binds `characterId` by name, which is what
// keeps a character on a consistent voice downstream.
export const PATCH = withAuth(
  async ({ userId, params, req }) => {
    const line = await prisma.voiceLine.findFirst({ where: { id: params.id, userId } });
    if (!line) throw new ApiError("NOT_FOUND", 404);
    const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    // Coerce per field: a non-string content/speaker used to reach Prisma and
    // 500 instead of being ignored. Unknown keys are dropped.
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    const body = {
      content: str(raw.content),
      speaker: str(raw.speaker),
      emotion: str(raw.emotion),
      emotionStrength: typeof raw.emotionStrength === "number" ? raw.emotionStrength : undefined,
      lineType: LINE_TYPES.has(raw.lineType as string) ? (raw.lineType as string) : undefined,
    };

    // 成片時間軸拖 chip：offsetMs null = 重設返 auto 順序排；數字 = 釘死位置（clamp 0–10min）。
    const offsetMs =
      raw.offsetMs === null
        ? null
        : typeof raw.offsetMs === "number"
          ? Math.max(0, Math.min(600_000, Math.round(raw.offsetMs)))
          : undefined;

    // 跨鏡拖 chip：目標鏡必須同一個 user 同一集，一個 where 齊截跨集／跨租戶兩種越權。
    let matchedShotId = line.matchedShotId;
    if (raw.matchedShotId === null) {
      matchedShotId = null;
    } else if (typeof raw.matchedShotId === "string") {
      const shot = await prisma.shot.findFirst({
        where: { id: raw.matchedShotId, userId, episodeId: line.episodeId },
        select: { id: true },
      });
      if (!shot) throw new ApiError("SHOT_NOT_IN_EPISODE", 400);
      matchedShotId = shot.id;
    }

    // Re-bind the character FK when the speaker name changes, matching against
    // the project's roster the same way the analyzer does. A speaker that names
    // no known character (e.g. 旁白) clears the binding rather than erroring.
    let characterId = line.characterId;
    if (typeof body.speaker === "string" && body.speaker !== line.speaker) {
      const episode = await prisma.episode.findUniqueOrThrow({
        where: { id: line.episodeId },
        select: { projectId: true },
      });
      const character = await prisma.character.findFirst({
        where: { projectId: episode.projectId, name: body.speaker },
        select: { id: true },
      });
      characterId = character?.id ?? null;
    }

    const updated = await prisma.voiceLine.update({
      where: { id: line.id },
      data: {
        content: body.content,
        speaker: body.speaker,
        emotion: body.emotion,
        // App-side cap mirrors the analyzer (schema comment: hard cap 0.5).
        emotionStrength: typeof body.emotionStrength === "number" ? Math.min(0.5, Math.max(0, body.emotionStrength)) : undefined,
        lineType: body.lineType,
        characterId,
        offsetMs,
        matchedShotId,
      },
    });
    return ok(updated);
  },
  { auditAction: "voice-line.edit" },
);
