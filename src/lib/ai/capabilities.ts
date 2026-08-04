import { z } from "zod";
import catalogJson from "../../../standards/capabilities.json";
import type { ApiType } from "@/lib/ai/model-key";

const capabilitiesSchema = z
  .object({
    durationsSec: z.array(z.number().positive()).optional(),
    resolutions: z.array(z.string()).optional(),
    aspectRatios: z.array(z.string()).optional(),
    modes: z.array(z.string()).optional(),
    supportsReferenceImages: z.boolean().optional(),
    // 首尾幀：i2v 除咗起幀之外仲收唔收一張尾幀（生成嘅片會由起幀過渡到尾幀）。
    // 唔用上面個 `modes` 表達 —— `modes` 由頭到尾都冇被任何邏輯讀過（純展示用
    // metadata），借佢做能力閘會令人以為 modes 有語義。呢個旗會喺 generateVideo
    // 度真係被讀，冇聲明就靜默唔傳尾幀（降級生片，唔會 fail）。
    supportsEndFrame: z.boolean().optional(),
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
    modelKey: z.string().regex(/^[^:]+::.+$/, "modelKey must be provider::modelId"),
    apiType: z.enum(["text", "image", "video", "tts"]),
    capabilities: capabilitiesSchema.optional(),
    pricing: z.discriminatedUnion("mode", [flatPricingSchema, textPricingSchema]),
    recommend: z.number().int().min(1).max(3).optional(),
    priceSource: z.enum(["openrouter-api", "manual"]).optional(),
    priceVerifiedAt: z.string().optional(),
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

export function priceMedia(modelKey: string, quantity: number): PriceSnapshot | null {
  const pricing = catalog.get(modelKey)?.pricing;
  if (!pricing || pricing.mode !== "flat") return null;
  return { unitPriceSnapshot: pricing.perUnit, estCostUsd: pricing.perUnit * quantity };
}

export function priceText(
  modelKey: string,
  inputTokens: number,
  outputTokens: number,
): { estCostUsd: number; inputPerMTok: number; outputPerMTok: number } | null {
  const pricing = catalog.get(modelKey)?.pricing;
  if (!pricing || pricing.mode !== "text") return null;
  const estCostUsd = (inputTokens / 1_000_000) * pricing.inputPerMTok + (outputTokens / 1_000_000) * pricing.outputPerMTok;
  return { estCostUsd, inputPerMTok: pricing.inputPerMTok, outputPerMTok: pricing.outputPerMTok };
}

export type { ApiType };
