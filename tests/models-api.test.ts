import { beforeAll, describe, expect, it } from "vitest";
import type { ProviderDef } from "@/lib/providers";

// Pure builders for GET /api/models — no env/DB, so no seeding needed (the module
// graph here never imports @/lib/env). The route supplies the presence sets; these
// tests assert the view shape and, critically, that NO key material can appear.
type ViewMod = typeof import("@/lib/models/catalog-view");
type CapMod = typeof import("@/lib/ai/capabilities");
type ProvMod = typeof import("@/lib/providers");
let V: ViewMod;
let C: CapMod;
let P: ProvMod;

beforeAll(async () => {
  V = await import("@/lib/models/catalog-view");
  C = await import("@/lib/ai/capabilities");
  P = await import("@/lib/providers");
});

const PROVIDERS: readonly ProviderDef[] = [
  { id: "openrouter", label: "OpenRouter", envKeyName: "OPENROUTER_API_KEY", authScheme: "bearer", byok: true, devOnly: false },
  { id: "fal", label: "fal.ai", envKeyName: "FAL_KEY", authScheme: "key", byok: true, devOnly: false },
  { id: "atlascloud", label: "AtlasCloud", envKeyName: "ATLASCLOUD_API_KEY", authScheme: "bearer", byok: true, devOnly: false },
  { id: "fake", label: "Fake (dev)", envKeyName: null, authScheme: "none", byok: false, devOnly: true },
];

describe("buildProvidersView — connection status precedence (presence only)", () => {
  it("prefers user-key over env-key over none", () => {
    const view = V.buildProvidersView({
      providers: PROVIDERS,
      userKeyProviders: new Set(["openrouter"]),
      envKeyProviders: new Set(["openrouter", "fal"]),
      includeDevOnly: true,
    });
    const byId = new Map(view.map((p) => [p.id, p.connected]));
    expect(byId.get("openrouter")).toBe("user-key"); // user key wins even though env present
    expect(byId.get("fal")).toBe("env-key");
    expect(byId.get("atlascloud")).toBe("none");
  });

  it("drops devOnly providers in production, keeps them in dev", () => {
    const prod = V.buildProvidersView({ providers: PROVIDERS, userKeyProviders: new Set(), envKeyProviders: new Set(), includeDevOnly: false });
    expect(prod.some((p) => p.id === "fake")).toBe(false);
    const dev = V.buildProvidersView({ providers: PROVIDERS, userKeyProviders: new Set(), envKeyProviders: new Set(), includeDevOnly: true });
    expect(dev.some((p) => p.id === "fake")).toBe(true);
  });

  it("exposes ONLY {id,label,connected} — no key material or registry internals", () => {
    const view = V.buildProvidersView({
      providers: PROVIDERS,
      userKeyProviders: new Set(["fal"]),
      envKeyProviders: new Set(),
      includeDevOnly: true,
    });
    for (const p of view) expect(Object.keys(p).sort()).toEqual(["connected", "id", "label"]);
    const json = JSON.stringify(view);
    for (const leak of ["envKeyName", "OPENROUTER_API_KEY", "FAL_KEY", "encryptedKey", "apiKey", "last4"]) {
      expect(json).not.toContain(leak);
    }
  });
});

describe("buildModelsView — catalog mapping", () => {
  it("maps flat + text pricing into unitPrice and derives provider from the key", () => {
    const models = V.buildModelsView(C.listCapabilityEntries(), true);
    const img = models.find((m) => m.modelKey === "fal::fal-ai/nano-banana-pro");
    expect(img).toMatchObject({ apiType: "image", provider: "fal", unitPrice: { mode: "flat", perUnit: 0.1, unit: "image" } });
    const text = models.find((m) => m.modelKey === "openrouter::google/gemini-2.5-flash-lite");
    expect(text).toMatchObject({
      apiType: "text",
      provider: "openrouter",
      unitPrice: { mode: "text", inputPerMTok: 0.1, outputPerMTok: 0.4 },
    });
  });

  it("excludes fake::* models in production, includes them in dev", () => {
    const prod = V.buildModelsView(C.listCapabilityEntries(), false);
    expect(prod.some((m) => m.provider === "fake")).toBe(false);
    const dev = V.buildModelsView(C.listCapabilityEntries(), true);
    expect(dev.some((m) => m.provider === "fake")).toBe(true);
  });

  it("exposes ONLY the whitelisted model fields — no pricing.currency leak or key material", () => {
    const models = V.buildModelsView(C.listCapabilityEntries(), true);
    for (const m of models) {
      expect(Object.keys(m).sort()).toEqual(["apiType", "capabilities", "modelKey", "provider", "recommend", "unitPrice"]);
    }
    const json = JSON.stringify(models);
    for (const leak of ["encryptedKey", "apiKey", "last4", "OPENROUTER_API_KEY", "FAL_KEY"]) {
      expect(json).not.toContain(leak);
    }
  });

  it("every catalog provider prefix is a known registry provider", () => {
    const known = new Set(P.PROVIDERS.map((p) => p.id));
    for (const m of V.buildModelsView(C.listCapabilityEntries(), true)) {
      expect(known.has(m.provider)).toBe(true);
    }
  });
});
