// Provider registry — the single source of truth for the providers ReelCraft can
// talk to. Neutral module (no AI-call surface, no @/lib/ai imports) so both the
// AI layer and the settings/API layer can share it without tripping the
// no-ai-bypass guard. Adapters/auth are code paths, so this lives in TS (not
// JSON): capabilities.json owns *models*, this owns *providers* (design doc
// 2026-07-19-provider-model-defaults). `template::` is a routing prefix, not a
// provider, and is deliberately absent here.
export interface ProviderDef {
  id: string;
  label: string;
  // Env var holding the shared server key, or null for providers with no key
  // (fake). Read via @/lib/env — never the raw environment directly.
  envKeyName: string | null;
  authScheme: "bearer" | "key" | "none";
  // Whether a user may store their own key for this provider (BYOK).
  byok: boolean;
  // dev/test-only providers (fake) — never usable in production.
  devOnly: boolean;
}

export const PROVIDERS: readonly ProviderDef[] = [
  { id: "openrouter", label: "OpenRouter", envKeyName: "OPENROUTER_API_KEY", authScheme: "bearer", byok: true, devOnly: false },
  { id: "fal", label: "fal.ai", envKeyName: "FAL_KEY", authScheme: "key", byok: true, devOnly: false },
  { id: "atlascloud", label: "AtlasCloud", envKeyName: "ATLASCLOUD_API_KEY", authScheme: "bearer", byok: true, devOnly: false },
  { id: "fake", label: "Fake (dev)", envKeyName: null, authScheme: "none", byok: false, devOnly: true },
];

export function getProviderDef(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

// The providers a user may store a BYO key for. Derived from PROVIDERS so the
// allowlist can never drift from the registry. Exported shape unchanged: a
// readonly string-literal tuple + `ByokProvider` union so existing imports and
// `where: { userId_provider }` typings keep working.
export const BYOK_PROVIDERS = ["openrouter", "fal", "atlascloud"] as const;
export type ByokProvider = (typeof BYOK_PROVIDERS)[number];

// Runtime cross-check: the hand-written tuple above (kept literal so the type
// stays a precise union) must match what the registry marks byok. Throws on boot
// if the two drift — cheaper than a subtly wrong allowlist.
{
  const fromRegistry = PROVIDERS.filter((p) => p.byok).map((p) => p.id).sort();
  const fromTuple = [...BYOK_PROVIDERS].sort();
  if (fromRegistry.join(",") !== fromTuple.join(",")) {
    throw new Error(`[providers] BYOK_PROVIDERS ${fromTuple.join(",")} drifted from registry byok set ${fromRegistry.join(",")}`);
  }
}

export function isByokProvider(p: string): p is ByokProvider {
  return (BYOK_PROVIDERS as readonly string[]).includes(p);
}
