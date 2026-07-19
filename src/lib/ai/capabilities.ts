// Capability + pricing catalog loader (docs/tech/03-provider-layer.md).
// standards/capabilities.json is the single source of unit prices — user-reported
// prices NEVER enter billing. Validated with zod at module load; a malformed
// catalog throws on boot (mirrored by the capability-catalog-check guard in CI).
import { z } from "zod";
import catalogJson from "../../../standards/capabilities.json";
import type { ApiType } from "@/lib/ai/model-key";

const capabilitiesSchema = z
  .object({
    durationsSec: z.array(z.number().positive()).optional(),
    resolutions: z.array(z.string()).optional(),
    aspectRatios: z.array(z.string()).optional(),
    modes: z.array(z.string()).optional(),
  })
  .strict();

const flatPricingSchema = z
  .object({
    mode: z.literal("flat"),
    perUnit: z.number().nonnegative(),
    unit: z.enum(["image", "second", "character"]),
    currency: z.literal("USD"),
  })
  .strict();

const textPricingSchema = z
  .object({
    mode: z.literal("text"),
    inputPerMTok: z.number().nonnegative(),
    outputPerMTok: z.number().nonnegative(),
    currency: z.literal("USD"),
  })
  .strict();

const entrySchema = z
  .object({
    // provider::modelId — non-empty provider, non-empty modelId, exactly one '::' anchor.
    modelKey: z.string().regex(/^[^:]+::.+$/, "modelKey must be provider::modelId"),
    apiType: z.enum(["text", "image", "video", "tts"]),
    capabilities: capabilitiesSchema.optional(),
    pricing: z.discriminatedUnion("mode", [flatPricingSchema, textPricingSchema]),
  })
  .strict();

const catalogSchema = z.array(entrySchema);

export type CapabilityEntry = z.infer<typeof entrySchema>;
export type FlatPricing = z.infer<typeof flatPricingSchema>;
export type TextPricing = z.infer<typeof textPricingSchema>;

function loadCatalog(): Map<string, CapabilityEntry> {
  const parsed = catalogSchema.safeParse(catalogJson);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  [${i.path.join(".")}] ${i.message}`).join("\n");
    throw new Error(`[capabilities] invalid standards/capabilities.json:\n${issues}`);
  }
  const byKey = new Map<string, CapabilityEntry>();
  for (const entry of parsed.data) {
    if (byKey.has(entry.modelKey)) throw new Error(`[capabilities] duplicate modelKey: ${entry.modelKey}`);
    byKey.set(entry.modelKey, entry);
  }
  return byKey;
}

const catalog = loadCatalog();

export function getCapabilityEntry(modelKey: string): CapabilityEntry | null {
  return catalog.get(modelKey) ?? null;
}

// Every catalog entry, in insertion order. For listing surfaces (the /api/models
// picker catalog); billing/resolution keep using the by-key lookups above.
export function listCapabilityEntries(): CapabilityEntry[] {
  return [...catalog.values()];
}

export function getCapabilities(modelKey: string): CapabilityEntry["capabilities"] | null {
  return catalog.get(modelKey)?.capabilities ?? null;
}

export interface PriceSnapshot {
  unitPriceSnapshot: number;
  estCostUsd: number;
}

// Flat-priced media (image/video/tts). Missing entry → null (SHADOW spirit:
// billing gaps are logged as null, never thrown — CLAUDE.md #6 / docs 04-audit).
export function priceMedia(modelKey: string, quantity: number): PriceSnapshot | null {
  const pricing = catalog.get(modelKey)?.pricing;
  if (!pricing || pricing.mode !== "flat") return null;
  return { unitPriceSnapshot: pricing.perUnit, estCostUsd: pricing.perUnit * quantity };
}

// Per-token text pricing. There is no single unit price, so unitPriceSnapshot is
// left null (the caller sets it); estCostUsd blends input+output rates.
export function priceText(
  modelKey: string,
  inputTokens: number,
  outputTokens: number,
): { estCostUsd: number } | null {
  const pricing = catalog.get(modelKey)?.pricing;
  if (!pricing || pricing.mode !== "text") return null;
  const estCostUsd = (inputTokens / 1_000_000) * pricing.inputPerMTok + (outputTokens / 1_000_000) * pricing.outputPerMTok;
  return { estCostUsd };
}

export type { ApiType };
