// List every catalog prompt with the caller's effective override layer
// (advanced-mode template management, Slice 4a of 2026-07-21-advanced-prompt-mode-design.md).
import { withAuth } from "@/lib/api/with-auth";
import { ok } from "@/lib/api/errors";
import { listPromptStatuses } from "@/lib/prompts/status";

export const GET = withAuth(async ({ userId, req }) => {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const prompts = await listPromptStatuses(userId, projectId);
  return ok({ prompts });
});
