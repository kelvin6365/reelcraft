"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { modelsQuery, providerKeysQuery } from "@/ui/query-keys";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/ui/auth-client";
import { PromptTemplatesTab } from "@/ui/prompts/PromptTemplatesTab";
import { useAdvancedMode } from "@/ui/prompts/useAdvancedMode";
import type { ProviderView } from "@/ui/types";
import { ProviderKeyRow } from "@/ui/settings/ProviderKeyRow";
import { UserModelDefaults } from "@/ui/settings/UserModelDefaults";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// 設定：自備金鑰（BYO-Key）+ 預設模型。逐個 provider 一行，只顯示 ••••後四碼，
// 明文只在瀏覽器輸入、送出後清空 —— API 從不回傳金鑰本身。供應商清單與連接狀態
// 由 /api/models 驅動；此處只保留 UI 說明文案。
const KEY_HINTS: Record<string, string> = {
  openrouter: "文字模型（劇本、分鏡）。於 OpenRouter 主控台 → Keys 建立金鑰。",
  fal: "圖像、影片、語音生成。於 fal 主控台 → API Keys 建立金鑰。",
  atlascloud: "圖像、影片備援供應商。於 AtlasCloud 主控台建立金鑰。",
};

export default function SettingsPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const enabled = !isPending && !!session;
  const keysQuery = useQuery({ ...providerKeysQuery(), enabled });
  const catalogQuery = useQuery({ ...modelsQuery(), enabled });
  const [tab, setTab] = useState("defaults");
  const { advancedMode, setAdvancedMode, pending: advancedPending } = useAdvancedMode({ enabled });

  useEffect(() => {
    if (isPending) return;
    if (!session) router.replace("/signin");
  }, [isPending, session, router]);

  // Stranded-tab guard: if advanced mode gets switched off while viewing the
  // prompts tab (only rendered when advancedMode is true), bounce back.
  useEffect(() => {
    if (!advancedMode && tab === "prompts") setTab("defaults");
  }, [advancedMode, tab]);

  const keys = keysQuery.data?.keys ?? null;
  const catalog = catalogQuery.data ?? null;
  const loadErr = keysQuery.error?.message ?? catalogQuery.error?.message ?? null;

  if (isPending || !session) {
    return (
      <AppShell active="settings" title="設定 · 模型預設">
        <div className="space-y-6 p-8">
          <div className="space-y-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-full max-w-xl" />
          </div>
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      </AppShell>
    );
  }

  const byProvider = new Map((keys ?? []).map((k) => [k.provider, k]));
  // BYOK key rows: the /api/models providers we have set-up copy for (excludes the
  // keyless fake dev provider, which has no hint entry).
  const keyProviders: ProviderView[] = (catalog?.providers ?? []).filter((p) => p.id in KEY_HINTS);

  return (
    <AppShell active="settings" title="設定 · 模型預設">
      <div className="space-y-6 p-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">設定</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            自備 API 金鑰（BYO-Key）。金鑰以 AES-256-GCM 加密儲存，僅在呼叫供應商時解密，永不回傳。未設定時使用平台共用金鑰。
          </p>
        </div>

        {loadErr && <p className="text-sm text-destructive">{loadErr}</p>}

        <Card className="py-0">
          <CardContent className="flex items-center justify-between gap-4 py-4">
            <div className="space-y-0.5">
              <Label htmlFor="advanced-mode-switch">進階模式 · 檢視同編輯 AI Prompt</Label>
              <p className="text-sm text-muted-foreground">
                開咗之後，每個生產站會出現 &lt;&gt; 掣，睇到實際送出嘅完整 prompt。
              </p>
            </div>
            <Switch
              id="advanced-mode-switch"
              checked={advancedMode}
              disabled={advancedPending}
              onCheckedChange={setAdvancedMode}
            />
          </CardContent>
        </Card>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="defaults">模型預設</TabsTrigger>
            <TabsTrigger value="keys">API 金鑰</TabsTrigger>
            {advancedMode && <TabsTrigger value="prompts">Prompt 模板</TabsTrigger>}
          </TabsList>

          <TabsContent value="defaults" className="space-y-4">
            {catalog ? (
              <UserModelDefaults
                models={catalog.models}
                providers={catalog.providers}
                onNavigateToKeys={() => setTab("keys")}
              />
            ) : (
              <Skeleton className="h-64 w-full" />
            )}
          </TabsContent>

          <TabsContent value="keys" className="space-y-4">
            <Card className="py-0">
              <CardHeader className="flex-row items-center justify-between gap-4 py-6">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">API 金鑰（BYO-Key）</h2>
                  <p className="text-sm text-muted-foreground">
                    金鑰以信封加密儲存，只喺呼叫供應商時解密 — 缺 Key 嘅 provider 下所有模型自動禁用。
                  </p>
                </div>
                <Badge variant="secondary" className="shrink-0 gap-1">
                  <ShieldCheck className="size-3.5" />
                  信封加密 AES-256
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4 pb-6">
                {keyProviders.map((p) => (
                  <ProviderKeyRow
                    key={p.id}
                    provider={p.id}
                    label={p.label}
                    hint={KEY_HINTS[p.id]}
                    stored={byProvider.get(p.id)}
                    connected={p.connected}
                  />
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {advancedMode && (
            <TabsContent value="prompts" className="space-y-4">
              <PromptTemplatesTab />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </AppShell>
  );
}
