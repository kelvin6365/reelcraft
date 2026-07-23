"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api, ApiClientError } from "@/ui/api";
import { ModelSelect } from "@/ui/model-select";
import { modelsQuery, qk, userModelDefaultsQuery } from "@/ui/query-keys";
import { useAction } from "./useAction";
import type { ApiTypeKey, ModelCatalogItem, ModelDefaults, ProviderView } from "@/ui/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

const SLOTS: { key: ApiTypeKey; label: string }[] = [
  { key: "text", label: "文字" },
  { key: "image", label: "圖像" },
  { key: "video", label: "視頻" },
  { key: "tts", label: "語音" },
];

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

function imageDisableReason(m: ModelCatalogItem): string | null {
  return m.capabilities?.supportsReferenceImages === false ? "唔支援參考圖（角色一致性會失效）" : null;
}

export function ModelPicker({
  id,
  modelDefaults,
  videoRatio,
  videoResolution,
}: {
  id: string;
  modelDefaults: ModelDefaults | null;
  videoRatio: string;
  videoResolution: string;
}) {
  const { data: catalog, error: catalogError } = useQuery(modelsQuery(id));
  const { data: userDefaults, error: userDefaultsError } = useQuery(userModelDefaultsQuery());
  const [saved, setSaved] = useState<ApiTypeKey | null>(null);
  const [imageWarning, setImageWarning] = useState<string | null>(null);
  const { busy, err, run } = useAction(qk.project(id));

  const queryErr = catalogError ?? userDefaultsError;
  const loadErr = queryErr ? (queryErr as ApiClientError).message : null;

  async function onChange(slot: ApiTypeKey, next: string) {
    setSaved(null);
    setImageWarning(null);
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
      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI 模型</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{loadErr}</p>
        </CardContent>
      </Card>
    );
  }

  const models = catalog?.models ?? [];
  const providers: ProviderView[] = catalog?.providers ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI 模型</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {SLOTS.map((s) => {
          const value = modelDefaults?.[s.key] ?? "";
          const hasUserDefault = userDefaults?.defaults?.[s.key] !== undefined;
          const placeholderLabel = hasUserDefault ? "(個人預設)" : "(系統預設)";

          return (
            <div className="space-y-1.5" key={s.key}>
              <Label htmlFor={`model-${s.key}`}>{s.label} model</Label>
              <ModelSelect
                apiType={s.key}
                value={value}
                models={models}
                providers={providers}
                onChange={(next) => void onChange(s.key, next)}
                placeholderLabel={placeholderLabel}
                disabled={busy || !catalog}
                extraDisabledReason={
                  s.key === "video"
                    ? (m) => videoDisableReason(m, videoRatio, videoResolution)
                    : s.key === "image"
                      ? imageDisableReason
                      : undefined
                }
              />
            </div>
          );
        })}

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>換 model 只影響之後新生成嘅內容。</span>
          {busy && (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" /> 儲存中…
            </span>
          )}
          {!busy && saved && <span>已儲存 ✓</span>}
        </div>

        {imageWarning && (
          <Alert>
            <AlertDescription>{imageWarning}</AlertDescription>
          </Alert>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
