// Pure helpers for the provider-keys API. Kept free of Next/Prisma so the
// validation + response-shaping logic is unit-testable in isolation.
import { BYOK_PROVIDERS, isByokProvider, type ByokProvider } from "@/lib/providers";

export { BYOK_PROVIDERS, isByokProvider };
export type { ByokProvider };

// What a stored key looks like to the client. Deliberately has NO plaintext and
// NO envelope field — rule #5: the API never returns the key material.
export interface ProviderKeyView {
  provider: string;
  last4: string;
  updatedAt: string;
}

export function toProviderKeyView(row: { provider: string; last4: string; updatedAt: Date }): ProviderKeyView {
  return { provider: row.provider, last4: row.last4, updatedAt: row.updatedAt.toISOString() };
}

export interface PutKeyInput {
  provider: ByokProvider;
  apiKey: string;
}

export type ValidationError = { code: string; message: string };

// Validate a PUT body. Trims the key (users paste with trailing whitespace).
export function parsePutBody(body: unknown): { ok: true; value: PutKeyInput } | { ok: false; error: ValidationError } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: { code: "INVALID_BODY", message: "expected an object" } };
  }
  const { provider, apiKey } = body as Record<string, unknown>;
  if (typeof provider !== "string" || !isByokProvider(provider)) {
    return { ok: false, error: { code: "PROVIDER_NOT_ALLOWED", message: `provider must be one of ${BYOK_PROVIDERS.join(", ")}` } };
  }
  if (typeof apiKey !== "string" || apiKey.trim().length < 8) {
    return { ok: false, error: { code: "INVALID_KEY", message: "apiKey must be at least 8 characters" } };
  }
  return { ok: true, value: { provider, apiKey: apiKey.trim() } };
}

export function parseProviderField(body: unknown): { ok: true; provider: ByokProvider } | { ok: false; error: ValidationError } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: { code: "INVALID_BODY", message: "expected an object" } };
  }
  const { provider } = body as Record<string, unknown>;
  if (typeof provider !== "string" || !isByokProvider(provider)) {
    return { ok: false, error: { code: "PROVIDER_NOT_ALLOWED", message: `provider must be one of ${BYOK_PROVIDERS.join(", ")}` } };
  }
  return { ok: true, provider };
}
