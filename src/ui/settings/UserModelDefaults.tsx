"use client";
// 設定 → 預設模型 card. Four ModelSelects (文字/圖像/視頻/語音) bound to the
// caller's user_model_defaults row. An unset slot shows「(系統預設)」and selecting
// it sends "" (clear → the API deletes the slot). Optimistic update with revert
// on error and 儲存中/已儲存 hints — same pattern as planning/ModelPicker.
import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/ui/api";
import { ModelSelect } from "@/ui/model-select";
import type { ApiTypeKey, ModelCatalogItem, ModelDefaults, ProviderView, UserModelDefaultsResponse } from "@/ui/types";

const SLOTS: { key: ApiTypeKey; label: string }[] = [
  { key: "text", label: "文字（劇本・分鏡）" },
  { key: "image", label: "圖像" },
  { key: "video", label: "視頻" },
  { key: "tts", label: "語音" },
];

export function UserModelDefaults({ models, providers }: { models: ModelCatalogItem[]; providers: ProviderView[] }) {
  const [defaults, setDefaults] = useState<ModelDefaults | null>(null);
  const [system, setSystem] = useState<UserModelDefaultsResponse["system"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<UserModelDefaultsResponse>("/api/user/model-defaults")
      .then((r) => {
        setDefaults(r.defaults);
        setSystem(r.system);
      })
      .catch((e: ApiClientError) => setErr(e.message));
  }, []);

  useEffect(() => load(), [load]);

  async function onChange(slot: ApiTypeKey, next: string) {
    const prev = defaults ?? {};
    // optimistic: "" clears the slot locally, otherwise set it.
    const optimistic: ModelDefaults = { ...prev };
    if (next === "") delete optimistic[slot];
    else optimistic[slot] = next;
    setDefaults(optimistic);
    setSaved(false);
    setErr(null);
    setBusy(true);
    try {
      const r = await api.put<UserModelDefaultsResponse>("/api/user/model-defaults", { defaults: { [slot]: next } });
      setDefaults(r.defaults);
      setSystem(r.system);
      setSaved(true);
    } catch (e) {
      setDefaults(prev); // revert
      setErr(e instanceof ApiClientError ? e.message : "儲存失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <strong>預設模型</strong>
        {busy && <span className="muted" style={{ fontSize: 13 }}>儲存中…</span>}
        {!busy && saved && <span className="muted" style={{ fontSize: 13 }}>已儲存 ✓</span>}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        設定個人預設模型；未設定的項目使用系統預設。專案可再覆寫。
      </p>
      {SLOTS.map((s) => (
        <div key={s.key} className="field" style={{ maxWidth: 460 }}>
          <label htmlFor={`model-${s.key}`}>{s.label}</label>
          <ModelSelect
            apiType={s.key}
            value={defaults?.[s.key] ?? ""}
            models={models}
            providers={providers}
            onChange={(next) => void onChange(s.key, next)}
            placeholderLabel={system ? `(系統預設：${system[s.key]})` : "(系統預設)"}
            disabled={busy || defaults === null}
          />
        </div>
      ))}
      {err && <p className="error-text" style={{ margin: 0 }}>{err}</p>}
    </div>
  );
}
