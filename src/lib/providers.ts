// The providers a user may store a BYO key for. Neutral module (no AI-call
// surface) so both the AI layer and the settings/API layer can share the
// allowlist without tripping the no-ai-bypass guard. `fake` is dev/test-only
// and has no real key, so it's deliberately excluded.
export const BYOK_PROVIDERS = ["openrouter", "fal", "atlascloud"] as const;
export type ByokProvider = (typeof BYOK_PROVIDERS)[number];

export function isByokProvider(p: string): p is ByokProvider {
  return (BYOK_PROVIDERS as readonly string[]).includes(p);
}
