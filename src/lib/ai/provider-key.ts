// Key resolution abstraction. M0: server env keys (userId ignored).
// M3 swaps the implementation for per-user envelope-encrypted BYO keys —
// callers never change. Only call-model.ts may import this.
import { env } from "@/lib/env";
import { AiError } from "@/lib/ai/types";

export function getProviderKey(_userId: string, provider: string): string {
  switch (provider) {
    case "openrouter": {
      if (!env.OPENROUTER_API_KEY) throw new AiError("PROVIDER_KEY_MISSING", "OPENROUTER_API_KEY not set");
      return env.OPENROUTER_API_KEY;
    }
    case "fal": {
      if (!env.FAL_KEY) throw new AiError("PROVIDER_KEY_MISSING", "FAL_KEY not set");
      return env.FAL_KEY;
    }
    case "atlascloud": {
      if (!env.ATLASCLOUD_API_KEY) throw new AiError("PROVIDER_KEY_MISSING", "ATLASCLOUD_API_KEY not set");
      return env.ATLASCLOUD_API_KEY;
    }
    case "fake": {
      if (env.NODE_ENV === "production") throw new AiError("PROVIDER_NOT_ALLOWED", "fake provider is dev/test only");
      return "fake-key";
    }
    default:
      // No guessing, no fallback (CLAUDE.md #3)
      throw new AiError("PROVIDER_UNKNOWN", `unknown provider: ${provider}`);
  }
}
