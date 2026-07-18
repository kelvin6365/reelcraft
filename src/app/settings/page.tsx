"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiClientError } from "@/ui/api";
import { TopBar } from "@/ui/TopBar";
import { useSession } from "@/ui/auth-client";
import type { ProviderKeysResponse, ProviderKeyView } from "@/ui/types";
import { ProviderKeyRow } from "@/ui/settings/ProviderKeyRow";

// 設定：自備金鑰（BYO-Key）。逐個 provider 一行，只顯示 ••••後四碼，
// 明文只在瀏覽器輸入、送出後清空 —— API 從不回傳金鑰本身。
const PROVIDERS = [
  { provider: "openrouter", label: "OpenRouter", hint: "文字模型（劇本、分鏡）。於 OpenRouter 主控台 → Keys 建立金鑰。" },
  { provider: "fal", label: "fal", hint: "圖像、影片、語音生成。於 fal 主控台 → API Keys 建立金鑰。" },
  { provider: "atlascloud", label: "AtlasCloud", hint: "圖像、影片備援供應商。於 AtlasCloud 主控台建立金鑰。" },
] as const;

export default function SettingsPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [keys, setKeys] = useState<ProviderKeyView[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<ProviderKeysResponse>("/api/user/provider-keys")
      .then((r) => setKeys(r.keys))
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

  if (isPending || (!keys && !loadErr)) return <div className="center-screen">載入中…</div>;

  const byProvider = new Map((keys ?? []).map((k) => [k.provider, k]));

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
          {PROVIDERS.map((p) => (
            <ProviderKeyRow
              key={p.provider}
              provider={p.provider}
              label={p.label}
              hint={p.hint}
              stored={byProvider.get(p.provider)}
              onChanged={load}
            />
          ))}
        </div>
      </main>
    </>
  );
}
