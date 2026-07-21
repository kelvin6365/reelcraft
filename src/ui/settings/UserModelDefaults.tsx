"use client";
// 設定 → 預設模型 card. Four ModelSelects (文字/圖像/視頻/語音) bound to the
// caller's user_model_defaults row. An unset slot shows「(系統預設)」and selecting
// it sends "" (clear → the API deletes the slot). Optimistic update with revert
// on error; save feedback (儲存中…/已儲存 ✓/錯誤) renders inline next to the slot
// that actually changed, not as one global line at the bottom.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AudioLines, CheckCircle2, Image as ImageIcon, Type, Video, XCircle } from "lucide-react";
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

type SlotStatus = "saving" | "saved" | "error";

function priceLabel(m: ModelCatalogItem | undefined): string | null {
  if (!m) return null;
  const p = m.unitPrice;
  if (p.mode === "text") return `US$${p.inputPerMTok} / 1M tokens`;
  return `US$${p.perUnit} / ${p.unit === "image" ? "張" : p.unit === "second" ? "秒" : p.unit}`;
}

export function UserModelDefaults({
  models,
  providers,
  onNavigateToKeys,
}: {
  models: ModelCatalogItem[];
  providers: ProviderView[];
  onNavigateToKeys?: () => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery(userModelDefaultsQuery());
  const [defaults, setDefaults] = useState<ModelDefaults | null>(null);
  const [system, setSystem] = useState<UserModelDefaultsResponse["system"] | null>(null);
  const [slotStatus, setSlotStatus] = useState<Partial<Record<ApiTypeKey, SlotStatus>>>({});
  const [slotError, setSlotError] = useState<Partial<Record<ApiTypeKey, string>>>({});
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      setDefaults(query.data.defaults);
      setSystem(query.data.system);
    }
  }, [query.data]);

  useEffect(() => {
    if (query.error) setLoadErr(query.error.message);
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
    setSlotStatus((s) => ({ ...s, [slot]: "saving" }));
    setSlotError((s) => {
      const n = { ...s };
      delete n[slot];
      return n;
    });
    try {
      const r = await mutation.mutateAsync({ slot, next });
      setDefaults(r.defaults);
      setSystem(r.system);
      setSlotStatus((s) => ({ ...s, [slot]: "saved" }));
      void queryClient.invalidateQueries({ queryKey: qk.userModelDefaults });
      setTimeout(() => {
        setSlotStatus((s) => (s[slot] === "saved" ? { ...s, [slot]: undefined } : s));
      }, 2000);
    } catch (e) {
      setDefaults(prev); // revert
      setSlotStatus((s) => ({ ...s, [slot]: "error" }));
      setSlotError((s) => ({ ...s, [slot]: e instanceof ApiClientError ? e.message : "儲存失敗" }));
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
          <p className="text-sm text-muted-foreground">
            四種模態任揀，按 provider 分組；站 UI 會顯示現用模型同單價（單價以美元 USD 計）
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-1 pb-6">
        {loadErr && <p className="pb-2 text-sm text-destructive">{loadErr}</p>}
        {SLOTS.map((s, i) => {
          const currentKey = defaults?.[s.key] || system?.[s.key] || "";
          const model = modelByKey.get(currentKey);
          const connected = model ? (connectedById.get(model.provider) ?? "none") : "none";
          const missingKey = !!model && connected === "none";
          const isOverride = !!defaults?.[s.key];
          const Icon = s.icon;
          const status = slotStatus[s.key];
          return (
            <div key={s.key} className={`py-4 ${i < SLOTS.length - 1 ? "border-b" : ""}`}>
              <div className="flex items-center gap-4">
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
                <div className="w-35 shrink-0 text-right text-sm text-muted-foreground">{priceLabel(model)}</div>
                <div className="w-27 shrink-0 text-right">
                  {missingKey ? (
                    <button
                      type="button"
                      onClick={onNavigateToKeys}
                      className="cursor-pointer"
                      title="點擊前往 API 金鑰分頁設定"
                    >
                      <Badge variant="destructive" className="hover:opacity-80">
                        缺 API Key
                      </Badge>
                    </button>
                  ) : isOverride ? (
                    <Badge variant="secondary">個人預設</Badge>
                  ) : (
                    <Badge variant="outline">系統預設</Badge>
                  )}
                </div>
              </div>
              {status && (
                <div className="mt-1 flex justify-end pr-27">
                  <span
                    role="status"
                    aria-live="polite"
                    className={`inline-flex items-center gap-1 text-xs ${
                      status === "error" ? "text-destructive" : "text-muted-foreground"
                    }`}
                  >
                    {status === "saving" && "儲存中…"}
                    {status === "saved" && (
                      <>
                        <CheckCircle2 className="size-3" />
                        已儲存
                      </>
                    )}
                    {status === "error" && (
                      <>
                        <XCircle className="size-3" />
                        {slotError[s.key] ?? "儲存失敗"}
                      </>
                    )}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
