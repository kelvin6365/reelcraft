// Prompt resolver — mirrors src/lib/model-defaults/resolve.ts in shape.
//
//   system template (catalog file)
//     ← user override   (PromptOverride row, projectId = "")
//       ← project override (PromptOverride row, projectId = scope.projectId)
//         ← one-off text (never persisted, wins outright, no DB read at all)
//
// `version` is ALWAYS the current catalog version, even when an override wins —
// it's the stable audit anchor AiCallLog.promptVersion relies on. `baseVersion`
// (only meaningful for user/project) comes from the override row itself, and
// `drifted` flags when that base has fallen behind the current catalog version.
import { prisma } from "@/lib/db";
import { checkOverridePlaceholders } from "@/lib/prompts/placeholders";
import { PromptError, readSystemTemplate, renderTemplate } from "@/lib/prompts/build-prompt";

export type PromptSource = "system" | "user" | "project" | "oneoff";

export interface ResolvedPrompt {
  text: string;
  promptId: string;
  version: string;
  source: PromptSource;
  baseVersion?: string;
  drifted: boolean;
}

export interface PromptScope {
  userId: string;
  projectId?: string | null;
  oneOffText?: string | null;
}

// "" is the user-layer sentinel (see prisma schema comment on PromptOverride.projectId).
const USER_LAYER = "";

export async function resolvePrompt(
  promptId: string,
  variables: Record<string, string>,
  scope: PromptScope,
): Promise<ResolvedPrompt> {
  const { entry, template: systemTemplate } = readSystemTemplate(promptId);

  // one-off wins outright — no DB read at all.
  if (scope.oneOffText != null) {
    const check = checkOverridePlaceholders(entry.variables, scope.oneOffText);
    if (!check.ok) throw new PromptError("PROMPT_OVERRIDE_INVALID", `${promptId}: ${check.message}`);
    const text = renderTemplate(promptId, scope.oneOffText, entry.variables, variables);
    return { text, promptId: entry.id, version: entry.version, source: "oneoff", drifted: false };
  }

  const projectKey = scope.projectId && scope.projectId !== "" ? scope.projectId : "";
  const rows = await prisma.promptOverride.findMany({
    where: { userId: scope.userId, promptId, projectId: { in: [USER_LAYER, projectKey] } },
  });

  const projectRow = projectKey !== USER_LAYER ? rows.find((r) => r.projectId === projectKey) : undefined;
  const userRow = rows.find((r) => r.projectId === USER_LAYER);
  const winner = projectRow ?? userRow;

  if (!winner) {
    const text = renderTemplate(promptId, systemTemplate, entry.variables, variables);
    return { text, promptId: entry.id, version: entry.version, source: "system", drifted: false };
  }

  const source: PromptSource = winner === projectRow ? "project" : "user";
  const check = checkOverridePlaceholders(entry.variables, winner.content);
  if (!check.ok) throw new PromptError("PROMPT_OVERRIDE_INVALID", `${promptId}: ${check.message}`);
  const text = renderTemplate(promptId, winner.content, entry.variables, variables);
  return {
    text,
    promptId: entry.id,
    version: entry.version,
    source,
    baseVersion: winner.baseVersion,
    drifted: winner.baseVersion !== entry.version,
  };
}
