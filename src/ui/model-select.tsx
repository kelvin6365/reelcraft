"use client";
// Reusable model picker for one apiType (text/image/video/tts). Options are the
// catalog models of that apiType, grouped by provider (optgroup). A model whose
// provider is not connected is disabled with a hover reason. The empty value
// selects `placeholderLabel` — callers map that to "" (clear override).
import type { ApiTypeKey, ModelCatalogItem, ProviderView } from "@/ui/types";

function priceHint(m: ModelCatalogItem): string {
  const p = m.unitPrice;
  if (p.mode === "flat") return `$${p.perUnit}/${p.unit}`;
  return `$${p.inputPerMTok}/$${p.outputPerMTok} per Mtok`;
}

// Cheap/mid/pricey badge — absolute thresholds per unit so the tier is stable
// regardless of what else is in the picker.
function priceTier(m: ModelCatalogItem): string {
  const p = m.unitPrice;
  if (p.mode === "text") return p.inputPerMTok <= 0.5 ? "$" : p.inputPerMTok <= 3 ? "$$" : "$$$";
  if (p.unit === "image") return p.perUnit <= 0.02 ? "$" : p.perUnit <= 0.05 ? "$$" : "$$$";
  if (p.unit === "second") return p.perUnit <= 0.06 ? "$" : p.perUnit <= 0.15 ? "$$" : "$$$";
  return "$"; // per-character TTS — all in the same cheap band today
}

// ★★★ top pick / ★★ solid / ★ legacy; unrated models show no stars.
function stars(m: ModelCatalogItem): string {
  return m.recommend ? "★".repeat(m.recommend) : "";
}

export function ModelSelect({
  apiType,
  value,
  models,
  providers,
  onChange,
  placeholderLabel,
  disabled,
  extraDisabledReason,
}: {
  apiType: ApiTypeKey;
  value: string; // "" = use the placeholder (cleared/unset)
  models: ModelCatalogItem[];
  providers: ProviderView[];
  onChange: (next: string) => void;
  placeholderLabel: string;
  disabled?: boolean;
  // Optional extra per-model disable check beyond provider connection (e.g. a
  // video model whose capabilities don't cover the project's ratio/resolution).
  // Returning a string disables the option and uses it as the hover reason.
  extraDisabledReason?: (m: ModelCatalogItem) => string | null;
}) {
  const connectedById = new Map(providers.map((p) => [p.id, p.connected]));
  const labelById = new Map(providers.map((p) => [p.id, p.label]));

  // Group this apiType's models by provider, preserving provider registry order.
  const forType = models.filter((m) => m.apiType === apiType);
  const providerOrder = providers.map((p) => p.id).filter((id) => forType.some((m) => m.provider === id));

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">{placeholderLabel}</option>
      {providerOrder.map((providerId) => {
        const groupModels = forType.filter((m) => m.provider === providerId);
        const connected = connectedById.get(providerId) ?? "none";
        const notConnected = connected === "none";
        return (
          <optgroup key={providerId} label={labelById.get(providerId) ?? providerId}>
            {groupModels.map((m) => {
              const modelId = m.modelKey.slice(m.modelKey.indexOf("::") + 2);
              const extraReason = notConnected ? null : (extraDisabledReason?.(m) ?? null);
              const isDisabled = notConnected || extraReason !== null;
              const reason = notConnected ? "此供應商尚未連接（需自備金鑰或平台金鑰）" : extraReason;
              return (
                <option
                  key={m.modelKey}
                  value={m.modelKey}
                  disabled={isDisabled}
                  title={reason ?? priceHint(m)}
                >
                  {[modelId, stars(m), priceTier(m)].filter(Boolean).join(" ")} · {priceHint(m)}
                  {notConnected ? "（未連接）" : ""}
                  {extraReason ? `（${extraReason}）` : ""}
                </option>
              );
            })}
          </optgroup>
        );
      })}
    </select>
  );
}
