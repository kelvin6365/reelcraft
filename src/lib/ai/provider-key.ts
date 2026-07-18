// Key resolution abstraction. Resolution order (M3 BYO-Key):
//   1. the user's own UserProviderKey (envelope-decrypted just-in-time), else
//   2. the server env key (shared fallback), else
//   3. PROVIDER_KEY_MISSING.
// Decryption is deferred to the moment of use — plaintext keys are never held
// beyond a single call and never persisted anywhere but the encrypted envelope.
// Only call-model.ts / generate-media.ts may import this.
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { decryptKey } from "@/lib/crypto-keys";
import { AiError } from "@/lib/ai/types";
import { isByokProvider, type ByokProvider } from "@/lib/providers";

function envKey(provider: ByokProvider): string {
  switch (provider) {
    case "openrouter":
      return env.OPENROUTER_API_KEY;
    case "fal":
      return env.FAL_KEY;
    case "atlascloud":
      return env.ATLASCLOUD_API_KEY;
  }
}

export async function getProviderKey(userId: string, provider: string): Promise<string> {
  if (provider === "fake") {
    if (env.NODE_ENV === "production") throw new AiError("PROVIDER_NOT_ALLOWED", "fake provider is dev/test only");
    return "fake-key";
  }

  if (!isByokProvider(provider)) {
    // No guessing, no fallback (CLAUDE.md #3)
    throw new AiError("PROVIDER_UNKNOWN", `unknown provider: ${provider}`);
  }

  // 1. user's own key wins.
  const row = await prisma.userProviderKey.findUnique({
    where: { userId_provider: { userId, provider } },
    select: { encryptedKey: true },
  });
  if (row) return decryptKey(row.encryptedKey);

  // 2. shared server env key.
  const shared = envKey(provider);
  if (shared) return shared;

  // 3. nothing configured.
  throw new AiError("PROVIDER_KEY_MISSING", `no key for provider: ${provider}`);
}
