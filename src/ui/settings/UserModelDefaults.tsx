"use client";
// 設定 → 預設模型 card. Four ModelSelects (文字/圖像/視頻/語音) bound to the
// caller's user_model_defaults row. An unset slot shows「(系統預設)」and selecting
// it sends "" (clear → the API deletes the slot). Optimistic update with revert
// on error and 儲存中/已儲存 hints — same pattern as planning/ModelPicker.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AudioLines, Image as ImageIcon, Type, Video } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, ApiClientError } from "@/ui/api";
import { qk, userModelDefaultsQuery } from "@/ui/query-keys";
import { ModelSelect } from "@/ui/model-select";
import type { ApiTypeKey, ModelCatalogItem, ModelDefaults, ProviderView, UserModelDefaultsResponse } from "@/ui/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

const SLOTS: { key: ApiTypeKey; label: string; hint: string; icon: LucideIcon }[] = [
  { key: "text", label: "文字", hint: "劇本解析 · 分集規劃 · 分鏡腳本", icon: Type },
  { key: "image", label: "圖像", hint: "角色定妝 · 鏡頭圖像 (img2img)", icon: ImageIcon },
  { key: "video", label: "視頻", hint: "鏡頭視頻生成", icon: Video },
  { key: "tts", label: "語音", hint: "對白配音 · 旁白", icon: AudioLines },
];

function priceLabel(m: ModelCatalogItem | undefined): string | null {
  if (!m) return null;
  const p = m.unitPrice;
  if (p.mode === "text") return `$${p.inputPerMTok} / 1M tokens`;
  return `$${p.perUnit} / ${p.unit === "image" ? "張" : p.unit === "second" ? "秒" : p.unit}`;
}

export function UserModelDefaults({ models, providers }: { models: ModelCatalogItem[]; providers: ProviderView[] }) {
  const queryClient = useQueryClient();
  const query = useQuery(userModelDefaultsQuery());
  const [defaults, setDefaults] = useState<ModelDefaults | null>(null);
  const [system, setSystem] = useState<UserModelDefaultsResponse["system"] | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      setDefaults(query.data.defaults);
      setSystem(query.data.system);
    }
  }, [query.data]);

  useEffect(() => {
    if (query.error) setErr(query.error.message);
  }, [query.error]);

  const mutation = useMutation({
    mutationFn: (input: { slot: ApiTypeKey; next: string }) =>
      api.put<UserModelDefaultsResponse>("/api/user/model-defaults", { defaults: { [input.slot]: input.next } }),
  });

  async function onChange(slot: ApiTypeKey, next: string) {
    const prev = defaults ?? {};
    // optimistic: "" clears the slot locally, otherwise set it.
    const optimistic: ModelDefaults = { ...prev };
    if (next === "") delete optimistic[slot];
    else optimistic[slot] = next;
    setDefaults(optimistic);
    setSaved(false);
    setErr(null);
    try {
      const r = await mutation.mutateAsync({ slot, next });
      setDefaults(r.defaults);
      setSystem(r.system);
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: qk.userModelDefaults });
    } catch (e) {
      setDefaults(prev); // revert
      setErr(e instanceof ApiClientError ? e.message : "儲存失敗");
    }
  }

  const busy = mutation.isPending;
  const connectedById = new Map(providers.map((p) => [p.id, p.connected]));
  const modelByKey = new Map(models.map((m) => [m.modelKey, m]));

  return (
    <Card className="py-0">
      <CardHeader className="flex-row items-center justify-between gap-4 py-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">模型預設 — 個人層</h2>
          <p className="text-sm text-muted-foreground">四種模態任揀，按 provider 分組；站 UI 會顯示現用模型同單價</p>
        </div>
        <Badge variant="secondary" className="shrink-0">
          provider::modelId 嚴格契約
        </Badge>
      </CardHeader>
      <CardContent className="space-y-1 pb-6">
        {SLOTS.map((s, i) => {
          const currentKey = defaults?.[s.key] || system?.[s.key] || "";
          const model = modelByKey.get(currentKey);
          const connected = model ? (connectedById.get(model.provider) ?? "none") : "none";
          const missingKey = !!model && connected === "none";
          const isOverride = !!defaults?.[s.key];
          const Icon = s.icon;
          return (
            <div
              key={s.key}
              className={`flex items-center gap-4 py-4 ${i < SLOTS.length - 1 ? "border-b" : ""}`}
            >
              <div className="flex w-60 shrink-0 items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Icon className="size-[18px]" />
                </div>
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold">{s.label}</p>
                  <p className="text-xs text-muted-foreground">{s.hint}</p>
                </div>
              </div>
              <div className="min-w-0 flex-1">
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
              <div className="w-35 shrink-0 text-right text-sm text-muted-foreground">
                {priceLabel(model)}
              </div>
              <div className="w-27 shrink-0 text-right">
                {missingKey ? (
                  <Badge variant="destructive">缺 API Key</Badge>
                ) : isOverride ? (
                  <Badge variant="secondary">個人預設</Badge>
                ) : (
                  <Badge variant="outline">系統預設</Badge>
                )}
              </div>
            </div>
          );
        })}
        <div className="flex items-center justify-between pt-4">
          {busy && <span className="text-sm text-muted-foreground">儲存中…</span>}
          {!busy && saved && <span className="text-sm text-muted-foreground">已儲存 ✓</span>}
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
