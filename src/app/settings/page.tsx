"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiClientError } from "@/ui/api";
import { TopBar } from "@/ui/TopBar";
import { useSession } from "@/ui/auth-client";
import type { ModelsResponse, ProviderKeysResponse, ProviderKeyView, ProviderView } from "@/ui/types";
import { ProviderKeyRow } from "@/ui/settings/ProviderKeyRow";
import { UserModelDefaults } from "@/ui/settings/UserModelDefaults";

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
  const [keys, setKeys] = useState<ProviderKeyView[] | null>(null);
  const [catalog, setCatalog] = useState<ModelsResponse | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api.get<ProviderKeysResponse>("/api/user/provider-keys"),
      api.get<ModelsResponse>("/api/models"),
    ])
      .then(([k, c]) => {
        setKeys(k.keys);
        setCatalog(c);
      })
      .catch((e: ApiClientError) => setLoadErr(e.message));
  }, []);

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.replace("/signin");
      return;
    }
    load();
  }, [isPending, session, router, load]);

  if (isPending || (!catalog && !loadErr)) return <div className="center-screen">載入中…</div>;

  const byProvider = new Map((keys ?? []).map((k) => [k.provider, k]));
  // BYOK key rows: the /api/models providers we have set-up copy for (excludes the
  // keyless fake dev provider, which has no hint entry).
  const keyProviders: ProviderView[] = (catalog?.providers ?? []).filter((p) => p.id in KEY_HINTS);

  return (
    <>
      <TopBar />
      <main className="container page-pad">
        <h1 style={{ fontSize: 24, marginBottom: 6 }}>設定</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          自備 API 金鑰（BYO-Key）。金鑰以 AES-256-GCM 加密儲存，僅在呼叫供應商時解密，永不回傳。
          未設定時使用平台共用金鑰。
        </p>

        {loadErr && <p className="error-text">{loadErr}</p>}

        <div className="stack" style={{ gap: 12, maxWidth: 560 }}>
          {keyProviders.map((p) => (
            <ProviderKeyRow
              key={p.id}
              provider={p.id}
              label={p.label}
              hint={KEY_HINTS[p.id]}
              stored={byProvider.get(p.id)}
              connected={p.connected}
              onChanged={load}
            />
          ))}

          {catalog && (
            <UserModelDefaults models={catalog.models} providers={catalog.providers} />
          )}
        </div>
      </main>
    </>
  );
}
