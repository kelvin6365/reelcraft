"use client";
// Per-project model picker (design doc 2026-07-19-provider-model-defaults, PR3).
// Fetches the provider/model catalog + the caller's user-layer defaults once,
// then renders 4 ModelSelects (文字/圖像/視頻/語音) bound to project.modelDefaults.
// PATCHes the merged object on change (preserving other slots), with the same
// optimistic 儲存中/已儲存 + revert-on-error pattern the old image-only picker used.
import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/ui/api";
import { ModelSelect } from "@/ui/model-select";
import { useAction } from "./useAction";
import type { ApiTypeKey, ModelCatalogItem, ModelDefaults, ModelsResponse, ProviderView, UserModelDefaultsResponse } from "@/ui/types";

const SLOTS: { key: ApiTypeKey; label: string }[] = [
  { key: "text", label: "文字" },
  { key: "image", label: "圖像" },
  { key: "video", label: "視頻" },
  { key: "tts", label: "語音" },
];

// Beyond ModelSelect's own "provider not connected" disable, video models also
// disable when they declare capabilities that exclude this project's ratio/res.
function videoDisableReason(
  m: ModelCatalogItem,
  videoRatio: string,
  videoResolution: string,
): string | null {
  const caps = m.capabilities;
  if (caps?.aspectRatios && !caps.aspectRatios.includes(videoRatio)) return `唔支援 ${videoRatio}`;
  if (caps?.resolutions && !caps.resolutions.includes(videoResolution)) return `唔支援 ${videoResolution}`;
  return null;
}

export function ModelPicker({
  id,
  modelDefaults,
  videoRatio,
  videoResolution,
  refetch,
}: {
  id: string;
  modelDefaults: ModelDefaults | null;
  videoRatio: string;
  videoResolution: string;
  refetch: () => Promise<void>;
}) {
  const [catalog, setCatalog] = useState<ModelsResponse | null>(null);
  const [userDefaults, setUserDefaults] = useState<UserModelDefaultsResponse | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<ApiTypeKey | null>(null);
  const [imageWarning, setImageWarning] = useState<string | null>(null);
  const { busy, err, run } = useAction(refetch);

  useEffect(() => {
    Promise.all([
      api.get<ModelsResponse>(`/api/models?projectId=${id}`),
      api.get<UserModelDefaultsResponse>("/api/user/model-defaults"),
    ])
      .then(([models, user]) => {
        setCatalog(models);
        setUserDefaults(user);
      })
      .catch((e: ApiClientError) => setLoadErr(e.message));
  }, [id]);

  async function onChange(slot: ApiTypeKey, next: string) {
    setSaved(null);
    setImageWarning(null);
    // No local optimistic value: the select's `value` derives from the
    // `modelDefaults` prop, which only changes once refetch() lands the new
    // project — so an error simply leaves the select showing the prior value.
    await run(async () => {
      const merged = { ...(modelDefaults ?? {}), [slot]: next };
      await api.patch(`/api/projects/${id}`, { modelDefaults: merged });
      if (slot === "image" && (catalog?.generatedImageCount ?? 0) > 0) {
        setImageWarning(
          `已有 ${catalog?.generatedImageCount} 張已生成圖像，換 model 只影響之後新生成，可能造成畫風不一致`,
        );
      }
      setSaved(slot);
    });
  }

  if (loadErr) {
    return (
      <div className="card section-gap">
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>AI 模型</h2>
        <p className="error-text">{loadErr}</p>
      </div>
    );
  }

  const models = catalog?.models ?? [];
  const providers: ProviderView[] = catalog?.providers ?? [];

  return (
    <div className="card section-gap">
      <h2 style={{ fontSize: 18, marginBottom: 4 }}>AI 模型</h2>
      {SLOTS.map((s) => {
        const value = modelDefaults?.[s.key] ?? "";
        const hasUserDefault = userDefaults?.defaults?.[s.key] !== undefined;
        const placeholderLabel = hasUserDefault ? "(個人預設)" : "(系統預設)";

        return (
          <div className="field" key={s.key} style={{ marginTop: 6, maxWidth: 420 }}>
            <label htmlFor={`model-${s.key}`}>{s.label} model</label>
            <ModelSelect
              apiType={s.key}
              value={value}
              models={models}
              providers={providers}
              onChange={(next) => void onChange(s.key, next)}
              placeholderLabel={placeholderLabel}
              disabled={busy || catalog === null}
              extraDisabledReason={
                s.key === "video" ? (m) => videoDisableReason(m, videoRatio, videoResolution) : undefined
              }
            />
          </div>
        );
      })}
      <div className="row" style={{ gap: 10, marginTop: 8 }}>
        <span className="faint" style={{ fontSize: 12 }}>換 model 只影響之後新生成嘅內容。</span>
        {busy && <span className="faint" style={{ fontSize: 12 }}>儲存中…</span>}
        {!busy && saved && <span className="faint" style={{ fontSize: 12 }}>已儲存 ✓</span>}
      </div>
      {imageWarning && <p className="faint" style={{ marginTop: 8, color: "var(--warn, #b45309)" }}>{imageWarning}</p>}
      {err && <p className="error-text" style={{ marginTop: 8 }}>{err}</p>}
    </div>
  );
}
