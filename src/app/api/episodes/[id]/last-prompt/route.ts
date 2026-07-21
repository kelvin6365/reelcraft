// 進階模式 (advanced prompt mode) — "上次送出" tab data source. Returns the most
// recent AiCallLog row for {episodeId, promptId} (the exact rendered text
// actually sent, faithfully captured by resolvePrompt/logAiCall) plus the
// currently-effective UNRENDERED template (which layer would win right now).
// These two things can legitimately diverge — the log is history, the
// template is "what would render next time" — the UI must not conflate them.
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { getOwnedEpisode } from "@/lib/api/episode-actions";
import { ok, fail } from "@/lib/api/errors";
import { getCatalogEntry, readSystemTemplate } from "@/lib/prompts/build-prompt";
import type { PromptSource } from "@/lib/prompts/resolve-prompt";

// "" is the user-layer sentinel (see prisma schema comment on PromptOverride.projectId).
const USER_LAYER = "";

export const GET = withAuth(async ({ userId, req, params }) => {
  const episode = await getOwnedEpisode(userId, params.id);

  const promptId = req.nextUrl.searchParams.get("promptId");
  if (!promptId) return fail("INVALID_QUERY", 400, "promptId is required");

  const entry = getCatalogEntry(promptId);
  if (!entry) return fail("PROMPT_NOT_FOUND", 404, `no catalog entry for promptId: ${promptId}`);

  const logRow = await prisma.aiCallLog.findFirst({
    where: { userId, episodeId: episode.id, promptId },
    orderBy: { at: "desc" },
    select: {
      at: true,
      modelKey: true,
      promptVersion: true,
      promptSource: true,
      renderedPrompt: true,
      inputTokens: true,
      outputTokens: true,
      estCostUsd: true,
      status: true,
      errorCode: true,
    },
  });

  const log = logRow
    ? {
        at: logRow.at.toISOString(),
        modelKey: logRow.modelKey,
        promptVersion: logRow.promptVersion,
        promptSource: logRow.promptSource as PromptSource | null,
        renderedPrompt: logRow.renderedPrompt,
        inputTokens: logRow.inputTokens,
        outputTokens: logRow.outputTokens,
        estCostUsd: logRow.estCostUsd == null ? null : Number(logRow.estCostUsd),
        status: logRow.status,
        errorCode: logRow.errorCode,
      }
    : null;

  const projectKey = episode.projectId ?? USER_LAYER;
  const overrideRows = await prisma.promptOverride.findMany({
    where: { userId, promptId, projectId: { in: [USER_LAYER, projectKey] } },
  });
  const projectRow = projectKey !== USER_LAYER ? overrideRows.find((r) => r.projectId === projectKey) : undefined;
  const userRow = overrideRows.find((r) => r.projectId === USER_LAYER);
  const winner = projectRow ?? userRow;

  const template = winner
    ? {
        content: winner.content,
        source: (winner === projectRow ? "project" : "user") as PromptSource,
        version: entry.version,
        baseVersion: winner.baseVersion,
        drifted: winner.baseVersion !== entry.version,
      }
    : {
        content: readSystemTemplate(promptId).template,
        source: "system" as PromptSource,
        version: entry.version,
        drifted: false,
      };

  return ok({ log, template });
});
