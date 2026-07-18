// Cheap live validation of a provider key. Lives in the AI layer (not the API
// layer) because it holds provider endpoints + resolves keys via getProviderKey
// — keeping it here satisfies the no-ai-bypass guard. Returns {ok} only; never
// echoes the key or the upstream body.
//
// Per provider, the smallest authenticated request that distinguishes
// "key works" from "key rejected":
//   openrouter — GET /models (200 ⇒ ok).
//   fal        — GET queue status of a bogus request id. A valid key gets 404
//                (id not found); a bad key gets 401/403 (auth rejected). So we
//                treat "not 401/403" as ok.
//   atlascloud — GET the models listing (not 401/403 ⇒ ok).
import { getProviderKey } from "@/lib/ai/provider-key";
import { AiError } from "@/lib/ai/types";
import type { ByokProvider } from "@/lib/providers";

type Fetch = typeof fetch;

const AUTH_REJECTED = new Set([401, 403]);

export async function testProviderKey(
  provider: ByokProvider,
  apiKey: string,
  fetchImpl: Fetch = fetch,
): Promise<{ ok: boolean }> {
  try {
    switch (provider) {
      case "openrouter": {
        const res = await fetchImpl("https://openrouter.ai/api/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return { ok: res.status === 200 };
      }
      case "fal": {
        // Bogus request id: valid key ⇒ 404, bad key ⇒ 401/403.
        const res = await fetchImpl(
          "https://queue.fal.run/fal-ai/any/requests/00000000-0000-0000-0000-000000000000/status",
          { headers: { Authorization: `Key ${apiKey}` } },
        );
        return { ok: !AUTH_REJECTED.has(res.status) };
      }
      case "atlascloud": {
        const res = await fetchImpl("https://api.atlascloud.ai/api/v1/model/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return { ok: !AUTH_REJECTED.has(res.status) };
      }
    }
  } catch {
    // Network failure ⇒ inconclusive, report not-ok rather than throwing.
    return { ok: false };
  }
}

// Resolve the caller's effective key (own BYO key, else env fallback) and
// validate it live. A missing key ⇒ {ok:false}, not an error.
export async function checkStoredProviderKey(userId: string, provider: ByokProvider): Promise<{ ok: boolean }> {
  let apiKey: string;
  try {
    apiKey = await getProviderKey(userId, provider);
  } catch (err) {
    if (err instanceof AiError && err.code === "PROVIDER_KEY_MISSING") return { ok: false };
    throw err;
  }
  return testProviderKey(provider, apiKey);
}
