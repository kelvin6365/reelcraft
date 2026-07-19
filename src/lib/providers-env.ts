// Env-backed provider helpers for the settings/models API. Isolated from the
// pure catalog-view builders so those stay env-free; the env module is the only
// place allowed to read the raw environment (no-raw-env guard). Presence only —
// this NEVER returns or logs a key value (rule #5).
import { env } from "@/lib/env";
import { PROVIDERS } from "@/lib/providers";

// The set of providers whose shared server env key is configured (non-empty).
// The env var names are matched explicitly (not indexed dynamically) so a
// provider with no envKeyName can never resolve to a stray value.
export function envKeyProviders(): Set<string> {
  const present = new Set<string>();
  for (const p of PROVIDERS) {
    switch (p.envKeyName) {
      case "OPENROUTER_API_KEY":
        if (env.OPENROUTER_API_KEY) present.add(p.id);
        break;
      case "FAL_KEY":
        if (env.FAL_KEY) present.add(p.id);
        break;
      case "ATLASCLOUD_API_KEY":
        if (env.ATLASCLOUD_API_KEY) present.add(p.id);
        break;
      default:
        break;
    }
  }
  return present;
}

export function isProduction(): boolean {
  return env.NODE_ENV === "production";
}
