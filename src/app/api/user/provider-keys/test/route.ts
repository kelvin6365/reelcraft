// POST /api/user/provider-keys/test {provider} — validate the caller's stored
// key with one cheap live request (server-side only). Returns {ok} — never the
// key or the upstream response. Key resolution + validation live in the AI
// layer (key-check) so this route never touches provider-key directly.
import { withAuth } from "@/lib/api/with-auth";
import { ok, fail } from "@/lib/api/errors";
import { checkStoredProviderKey } from "@/lib/ai/key-check";
import { parseProviderField } from "@/lib/user/provider-keys";

export const POST = withAuth(async ({ userId, req }) => {
  const parsed = parseProviderField(await req.json().catch(() => null));
  if (!parsed.ok) return fail(parsed.error.code, 400, parsed.error.message);

  const result = await checkStoredProviderKey(userId, parsed.provider);
  return ok(result);
});
