// Pure builders for GET /api/models. Shape the provider registry + capability
// catalog into the client-facing view. No Prisma/Next/env here — the route
// supplies the dynamic inputs (which providers have keys, whether we're in prod)
// so this logic stays unit-testable and can never leak key material (rule #5).
import { parseModelKeyStrict, type ApiType } from "@/lib/ai/model-key";
import type { CapabilityEntry } from "@/lib/ai/capabilities";
import type { ProviderDef } from "@/lib/providers";

// A provider has a user's own BYO key, a shared server env key, or nothing. This
// is a PRESENCE flag only — never the key itself, and never a live-ping result.
export type ConnectionStatus = "user-key" | "env-key" | "none";

export interface ProviderView {
  id: string;
  label: string;
  connected: ConnectionStatus;
}

export type UnitPrice =
  | { mode: "flat"; perUnit: number; unit: string }
  | { mode: "text"; inputPerMTok: number; outputPerMTok: number };

export interface ModelView {
  modelKey: string;
  apiType: ApiType;
  provider: string;
  capabilities: CapabilityEntry["capabilities"];
  unitPrice: UnitPrice;
}

export interface ProvidersInput {
  providers: readonly ProviderDef[];
  userKeyProviders: ReadonlySet<string>;
  envKeyProviders: ReadonlySet<string>;
  // Drop devOnly providers (fake) when running in production.
  includeDevOnly: boolean;
}

export function buildProvidersView(input: ProvidersInput): ProviderView[] {
  const { providers, userKeyProviders, envKeyProviders, includeDevOnly } = input;
  const out: ProviderView[] = [];
  for (const p of providers) {
    if (p.devOnly && !includeDevOnly) continue;
    const connected: ConnectionStatus = userKeyProviders.has(p.id)
      ? "user-key"
      : envKeyProviders.has(p.id)
        ? "env-key"
        : "none";
    out.push({ id: p.id, label: p.label, connected });
  }
  return out;
}

function toUnitPrice(pricing: CapabilityEntry["pricing"]): UnitPrice {
  return pricing.mode === "flat"
    ? { mode: "flat", perUnit: pricing.perUnit, unit: pricing.unit }
    : { mode: "text", inputPerMTok: pricing.inputPerMTok, outputPerMTok: pricing.outputPerMTok };
}

// Map catalog entries to the client view. `includeDevOnly=false` drops fake::*
// models so a prod picker never offers the dev stub (mirrors the provider list).
export function buildModelsView(entries: readonly CapabilityEntry[], includeDevOnly: boolean): ModelView[] {
  const out: ModelView[] = [];
  for (const e of entries) {
    const parsed = parseModelKeyStrict(e.modelKey);
    if (!parsed) continue; // catalog is guard-validated, but stay defensive
    if (!includeDevOnly && parsed.provider === "fake") continue;
    out.push({
      modelKey: e.modelKey,
      apiType: e.apiType,
      provider: parsed.provider,
      capabilities: e.capabilities,
      unitPrice: toUnitPrice(e.pricing),
    });
  }
  return out;
}
