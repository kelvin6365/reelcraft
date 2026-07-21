// GET /api/user/provider-readiness — onboarding guardrail so a non-technical
// user never hits PROVIDER_KEY_MISSING blind (design doc
// 2026-07-19-provider-model-defaults). For every apiType slot in the caller's
// CURRENT resolved model defaults (project override ← user ← system, see
// resolveModelDefaults), report whether that slot's provider has a usable key
// and where it came from. PRESENCE only — never key material (rule #5).
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api/with-auth";
import { ApiError, ok } from "@/lib/api/errors";
import { getProviderDef } from "@/lib/providers";
import { parseModelKeyStrict, type ApiType } from "@/lib/ai/model-key";
import { resolveModelDefaults } from "@/lib/model-defaults/resolve";
import { envKeyProviders } from "@/lib/providers-env";
import type { Project } from "@prisma/client";

const API_TYPE_LABEL: Record<ApiType, string> = {
  text: "文字模型",
  image: "圖像模型",
  video: "影片模型",
  tts: "語音模型",
};

export const GET = withAuth(async ({ userId, req }) => {
  const projectId = req.nextUrl.searchParams.get("projectId");
  let project: Pick<Project, "modelDefaults"> | null = null;
  if (projectId) {
    project = await prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { modelDefaults: true },
    });
    if (!project) throw new ApiError("NOT_FOUND", 404);
  }

  const resolved = await resolveModelDefaults(userId, project);

  const userKeyRows = await prisma.userProviderKey.findMany({ where: { userId }, select: { provider: true } });
  const userKeyProviders = new Set(userKeyRows.map((r) => r.provider));
  const envKeyProviderSet = envKeyProviders();

  const apiTypes: readonly ApiType[] = ["text", "image", "video", "tts"];
  const items = apiTypes.map((apiType) => {
    const modelKey = resolved[apiType];
    const parsed = parseModelKeyStrict(modelKey);
    const provider = parsed?.provider ?? "unknown";
    const providerDef = getProviderDef(provider);
    // fake:: is the dev-only no-key stub (MODEL_DEFAULTS_PRESET=fake) — it never
    // needs a provider key, so it's always "ready" rather than reporting a
    // false-positive PROVIDER_KEY_MISSING warning to a dev/CI environment.
    const source: "platform" | "user" | null =
      provider === "fake"
        ? "platform"
        : userKeyProviders.has(provider)
          ? "user"
          : envKeyProviderSet.has(provider)
            ? "platform"
            : null;
    return {
      apiType,
      apiTypeLabel: API_TYPE_LABEL[apiType],
      provider,
      providerLabel: providerDef?.label ?? provider,
      modelKey,
      ready: source !== null,
      source,
    };
  });

  return ok({ items, allReady: items.every((i) => i.ready) });
});
