import { beforeAll, describe, expect, it, vi } from "vitest";

// env.ts fail-fasts at import; populate required vars before dynamic imports.
process.env.DATABASE_URL ??= "postgres://user:pw@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.STORAGE_ENDPOINT ??= "http://localhost:9000";
process.env.STORAGE_ACCESS_KEY ??= "test";
process.env.STORAGE_SECRET_KEY ??= "test";
process.env.STORAGE_BUCKET ??= "test";
process.env.BETTER_AUTH_SECRET ??= "test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.API_ENCRYPTION_KEY = "unit-test-encryption-key-0123456789";

type Helpers = typeof import("@/lib/user/provider-keys");
type TestMod = typeof import("@/lib/ai/key-check");
type ProvidersMod = typeof import("@/lib/providers");
let H: Helpers;
let T: TestMod;
let P: ProvidersMod;

beforeAll(async () => {
  H = await import("@/lib/user/provider-keys");
  T = await import("@/lib/ai/key-check");
  P = await import("@/lib/providers");
});

describe("BYOK_PROVIDERS — derived from the provider registry", () => {
  it("matches exactly the registry providers marked byok", () => {
    const fromRegistry = P.PROVIDERS.filter((p) => p.byok).map((p) => p.id).sort();
    expect([...P.BYOK_PROVIDERS].sort()).toEqual(fromRegistry);
  });

  it("excludes fake (dev-only, no BYOK) but includes the three real providers", () => {
    expect(P.isByokProvider("fake")).toBe(false);
    expect(P.isByokProvider("openrouter")).toBe(true);
    expect(P.isByokProvider("fal")).toBe(true);
    expect(P.isByokProvider("atlascloud")).toBe(true);
  });

  it("registry envKeyName is null exactly for the keyless fake provider", () => {
    expect(P.getProviderDef("fake")?.envKeyName).toBeNull();
    expect(P.getProviderDef("openrouter")?.envKeyName).toBe("OPENROUTER_API_KEY");
    expect(P.getProviderDef("fal")?.envKeyName).toBe("FAL_KEY");
  });
});

describe("parsePutBody", () => {
  it("accepts a valid provider + key and trims whitespace", () => {
    const r = H.parsePutBody({ provider: "openrouter", apiKey: "  sk-or-v1-abcd1234  " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ provider: "openrouter", apiKey: "sk-or-v1-abcd1234" });
  });

  it("rejects an unknown provider", () => {
    const r = H.parsePutBody({ provider: "openai", apiKey: "sk-1234567890" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("PROVIDER_NOT_ALLOWED");
  });

  it("rejects the fake provider (not a BYOK provider)", () => {
    const r = H.parsePutBody({ provider: "fake", apiKey: "fake-key-1234" });
    expect(r.ok).toBe(false);
  });

  it("rejects a too-short key", () => {
    const r = H.parsePutBody({ provider: "fal", apiKey: "short" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_KEY");
  });

  it("rejects a non-object body", () => {
    expect(H.parsePutBody(null).ok).toBe(false);
    expect(H.parsePutBody("nope").ok).toBe(false);
  });
});

describe("parseProviderField", () => {
  it("accepts an allowlisted provider", () => {
    const r = H.parseProviderField({ provider: "atlascloud" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.provider).toBe("atlascloud");
  });
  it("rejects anything else", () => {
    expect(H.parseProviderField({ provider: "fake" }).ok).toBe(false);
    expect(H.parseProviderField({}).ok).toBe(false);
  });
});

describe("toProviderKeyView — rule #5: no key material in the response", () => {
  it("exposes only provider, last4, updatedAt", () => {
    const view = H.toProviderKeyView({
      provider: "openrouter",
      last4: "1234",
      updatedAt: new Date("2026-07-18T00:00:00.000Z"),
    });
    expect(Object.keys(view).sort()).toEqual(["last4", "provider", "updatedAt"]);
    // Serialize the way the API would and assert no key fields leak.
    const json = JSON.stringify(view);
    expect(json).not.toContain("apiKey");
    expect(json).not.toContain("encryptedKey");
    expect(json).not.toContain("envelope");
  });
});

describe("testProviderKey — live validation logic", () => {
  const okRes = (status: number) => ({ status }) as Response;
  const fetchMock = (status: number) => vi.fn(async () => okRes(status)) as unknown as typeof fetch;

  it("openrouter: 200 ⇒ ok", async () => {
    expect(await T.testProviderKey("openrouter", "k", fetchMock(200))).toEqual({ ok: true });
    expect(await T.testProviderKey("openrouter", "k", fetchMock(401))).toEqual({ ok: false });
  });

  it("fal: 404 (valid key, bogus id) ⇒ ok; 401 ⇒ not ok", async () => {
    expect(await T.testProviderKey("fal", "k", fetchMock(404))).toEqual({ ok: true });
    expect(await T.testProviderKey("fal", "k", fetchMock(401))).toEqual({ ok: false });
    expect(await T.testProviderKey("fal", "k", fetchMock(403))).toEqual({ ok: false });
  });

  it("atlascloud: non-auth-rejection ⇒ ok", async () => {
    expect(await T.testProviderKey("atlascloud", "k", fetchMock(200))).toEqual({ ok: true });
    expect(await T.testProviderKey("atlascloud", "k", fetchMock(403))).toEqual({ ok: false });
  });

  it("sends the key in the Authorization header, never in the URL", async () => {
    const spy = vi.fn(async () => okRes(200)) as unknown as typeof fetch;
    await T.testProviderKey("openrouter", "secret-key", spy);
    const [url, init] = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).not.toContain("secret-key");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer secret-key" });
  });

  it("network failure ⇒ ok:false rather than throwing", async () => {
    const boom = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await T.testProviderKey("openrouter", "k", boom)).toEqual({ ok: false });
  });
});
