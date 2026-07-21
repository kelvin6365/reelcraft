// Detail + CRUD for a single catalog prompt's user/project override layer
// (advanced-mode template management, Slice 4a). See
// docs/plans/2026-07-21-advanced-prompt-mode-design.md and the Slice 4a plan.
import { withAuth } from "@/lib/api/with-auth";
import { ok, fail } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";
import { getOwnedProject } from "@/lib/api/project-actions";
import { getCatalogEntry, readSystemTemplate } from "@/lib/prompts/build-prompt";
import { checkOverridePlaceholders, detectFormatDrop } from "@/lib/prompts/placeholders";
import { getPromptDetail } from "@/lib/prompts/status";

const MAX_OVERRIDE_LENGTH = 100_000;
const USER_LAYER = "";

// "" and undefined both mean the user layer; a non-empty projectId must be
// verified as owned by the caller before any row gets tagged with it.
async function resolveProjectKey(userId: string, projectId: string | null | undefined): Promise<string> {
  if (!projectId) return USER_LAYER;
  await getOwnedProject(userId, projectId);
  return projectId;
}

export const GET = withAuth(async ({ userId, params, req }) => {
  const promptId = params.promptId;
  const projectId = req.nextUrl.searchParams.get("projectId");
  const detail = await getPromptDetail(userId, promptId, projectId);
  if (!detail) return fail("NOT_FOUND", 404, `no catalog entry for promptId: ${promptId}`);
  return ok(detail);
});

export const PUT = withAuth(
  async ({ userId, params, req }) => {
    const promptId = params.promptId;
    const entry = getCatalogEntry(promptId);
    if (!entry) return fail("NOT_FOUND", 404, `no catalog entry for promptId: ${promptId}`);

    const body = (await req.json().catch(() => null)) as { content?: unknown; projectId?: unknown } | null;
    if (typeof body !== "object" || body === null || typeof body.content !== "string") {
      return fail("BAD_REQUEST", 400, "expected { content: string, projectId?: string }");
    }
    if (body.projectId !== undefined && typeof body.projectId !== "string") {
      return fail("BAD_REQUEST", 400, "projectId must be a string");
    }
    const content = body.content;
    if (content.length > MAX_OVERRIDE_LENGTH) {
      return fail("PROMPT_OVERRIDE_TOO_LONG", 400, `override exceeds ${MAX_OVERRIDE_LENGTH} characters`);
    }

    // Ownership check: a PUT carrying someone else's projectId must not
    // silently write a row tagged with it — getOwnedProject throws 403.
    const projectKey = await resolveProjectKey(userId, (body.projectId as string | undefined) ?? null);

    const check = checkOverridePlaceholders(entry.variables, content);
    if (!check.ok) return fail(check.code, 400, check.message);

    const { template: systemTemplate } = readSystemTemplate(promptId);

    await prisma.promptOverride.upsert({
      where: { userId_projectId_promptId: { userId, projectId: projectKey, promptId } },
      create: {
        id: newId(),
        userId,
        projectId: projectKey,
        promptId,
        content,
        baseVersion: entry.version,
        baseContent: systemTemplate,
      },
      update: {
        content,
        baseVersion: entry.version,
        baseContent: systemTemplate,
      },
    });

    const detail = await getPromptDetail(userId, promptId, projectKey || null);
    if (!detail) return fail("NOT_FOUND", 404, `no catalog entry for promptId: ${promptId}`);
    const warnings = detectFormatDrop(systemTemplate, content);
    return ok({ ...detail, warnings });
  },
  { auditAction: "prompt.override-set" },
);

export const DELETE = withAuth(
  async ({ userId, params, req }) => {
    const promptId = params.promptId;
    const entry = getCatalogEntry(promptId);
    if (!entry) return fail("NOT_FOUND", 404, `no catalog entry for promptId: ${promptId}`);

    const projectIdParam = req.nextUrl.searchParams.get("projectId");
    const projectKey = await resolveProjectKey(userId, projectIdParam);

    await prisma.promptOverride.deleteMany({ where: { userId, projectId: projectKey, promptId } });

    const detail = await getPromptDetail(userId, promptId, projectKey || null);
    if (!detail) return fail("NOT_FOUND", 404, `no catalog entry for promptId: ${promptId}`);
    return ok(detail);
  },
  { auditAction: "prompt.override-clear" },
);
