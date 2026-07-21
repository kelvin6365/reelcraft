// Read-side views for the prompt template management API (Slice 4a). Builds
// PromptStatusView/PromptDetailView by joining the catalog against a user's
// PromptOverride rows — one findMany per call, never N+1 per catalog entry.
import { prisma } from "@/lib/db";
import type { PromptOverride } from "@prisma/client";
import { type CatalogEntry, getCatalogEntry, listCatalog, readSystemTemplate } from "@/lib/prompts/build-prompt";

export type PromptEffectiveSource = "system" | "user" | "project";

export interface PromptStatusView {
  promptId: string;
  description: string;
  version: string;
  variables: string[];
  source: PromptEffectiveSource;
  hasUserOverride: boolean;
  hasProjectOverride: boolean;
  baseVersion?: string;
  drifted: boolean;
}

export interface OverrideLayerView {
  content: string;
  baseVersion: string;
  baseContent: string;
  updatedAt: string;
}

export interface PromptDetailView extends PromptStatusView {
  system: string;
  user: OverrideLayerView | null;
  project: OverrideLayerView | null;
  effective: { content: string; source: PromptEffectiveSource };
}

// "" is the user-layer sentinel (see prisma schema comment on PromptOverride.projectId).
const USER_LAYER = "";

function normalizeProjectKey(projectId: string | null | undefined): string {
  return projectId && projectId !== "" ? projectId : USER_LAYER;
}

async function fetchOverrides(
  userId: string,
  promptId: string | undefined,
  projectKey: string,
): Promise<PromptOverride[]> {
  return prisma.promptOverride.findMany({
    where: {
      userId,
      ...(promptId ? { promptId } : {}),
      projectId: { in: projectKey === USER_LAYER ? [USER_LAYER] : [USER_LAYER, projectKey] },
    },
  });
}

function statusFor(entry: CatalogEntry, rows: PromptOverride[], projectKey: string): PromptStatusView {
  const userRow = rows.find((r) => r.promptId === entry.id && r.projectId === USER_LAYER);
  const projectRow =
    projectKey !== USER_LAYER ? rows.find((r) => r.promptId === entry.id && r.projectId === projectKey) : undefined;
  const winner = projectRow ?? userRow;
  const source: PromptEffectiveSource = winner ? (winner === projectRow ? "project" : "user") : "system";
  return {
    promptId: entry.id,
    description: entry.description,
    version: entry.version,
    variables: entry.variables,
    source,
    hasUserOverride: Boolean(userRow),
    hasProjectOverride: Boolean(projectRow),
    baseVersion: winner?.baseVersion,
    drifted: winner ? winner.baseVersion !== entry.version : false,
  };
}

export async function listPromptStatuses(
  userId: string,
  projectId: string | null | undefined,
): Promise<PromptStatusView[]> {
  const projectKey = normalizeProjectKey(projectId);
  const entries = listCatalog();
  const rows = await fetchOverrides(userId, undefined, projectKey);
  return entries.map((entry) => statusFor(entry, rows, projectKey));
}

export async function getPromptDetail(
  userId: string,
  promptId: string,
  projectId: string | null | undefined,
): Promise<PromptDetailView | null> {
  const entry = getCatalogEntry(promptId);
  if (!entry) return null;

  const projectKey = normalizeProjectKey(projectId);
  const rows = await fetchOverrides(userId, promptId, projectKey);
  const status = statusFor(entry, rows, projectKey);
  const { template: system } = readSystemTemplate(promptId);

  const userRow = rows.find((r) => r.projectId === USER_LAYER);
  const projectRow = projectKey !== USER_LAYER ? rows.find((r) => r.projectId === projectKey) : undefined;
  const toLayer = (row: PromptOverride | undefined): OverrideLayerView | null =>
    row
      ? { content: row.content, baseVersion: row.baseVersion, baseContent: row.baseContent, updatedAt: row.updatedAt.toISOString() }
      : null;

  const winner = projectRow ?? userRow;
  const effective = { content: winner ? winner.content : system, source: status.source };

  return { ...status, system, user: toLayer(userRow), project: toLayer(projectRow), effective };
}
