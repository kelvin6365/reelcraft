"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cloud, Globe, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, ApiClientError } from "@/ui/api";
import { qk } from "@/ui/query-keys";
import type { ConnectionStatus, ProviderKeyView } from "@/ui/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// One provider's key row: masked display (••••last4) when stored, a password
// field to set/replace, plus 測試 and 刪除. The plaintext never leaves this
// input — it's POSTed once and cleared.
const CONNECTION_BADGE: Record<ConnectionStatus, { text: string; variant: "secondary" | "outline" | "destructive" }> = {
  "user-key": { text: "已連接·自備金鑰", variant: "secondary" },
  "env-key": { text: "已連接·平台金鑰", variant: "secondary" },
  none: { text: "未連接", variant: "destructive" },
};

const PROVIDER_ICON: Record<string, LucideIcon> = {
  openrouter: Globe,
  fal: Zap,
  atlascloud: Cloud,
};

export function ProviderKeyRow({
  provider,
  label,
  hint,
  stored,
  connected,
}: {
  provider: string;
  label: string;
  hint: string;
  stored: ProviderKeyView | undefined;
  connected?: ConnectionStatus;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const saveMutation = useMutation({
    mutationFn: (apiKey: string) => api.put("/api/user/provider-keys", { provider, apiKey }),
    onSuccess: () => {
      setValue("");
      setMsg({ kind: "ok", text: "已儲存" });
      void queryClient.invalidateQueries({ queryKey: qk.providerKeys });
    },
    onError: (e) => {
      setMsg({ kind: "err", text: e instanceof ApiClientError ? e.message : "儲存失敗" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => api.del("/api/user/provider-keys", { provider }),
    onSuccess: () => {
      setMsg({ kind: "ok", text: "已刪除" });
      void queryClient.invalidateQueries({ queryKey: qk.providerKeys });
    },
    onError: (e) => {
      setMsg({ kind: "err", text: e instanceof ApiClientError ? e.message : "刪除失敗" });
    },
  });

  const busy = saveMutation.isPending || removeMutation.isPending || testBusy;

  function save() {
    if (value.trim().length < 8) {
      setMsg({ kind: "err", text: "金鑰太短（至少 8 字元）" });
      return;
    }
    setMsg(null);
    saveMutation.mutate(value.trim());
  }

  function remove() {
    setMsg(null);
    removeMutation.mutate();
  }

  async function test() {
    setTestBusy(true);
    setMsg(null);
    try {
      const res = await api.post<{ ok: boolean }>("/api/user/provider-keys/test", { provider });
      setMsg(res.ok ? { kind: "ok", text: "金鑰有效" } : { kind: "err", text: "金鑰無效或未設定" });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiClientError ? e.message : "測試失敗" });
    } finally {
      setTestBusy(false);
    }
  }

  const Icon = PROVIDER_ICON[provider] ?? Globe;

  return (
    <div className="space-y-3 border-b py-4 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex w-60 shrink-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Icon className="size-[18px]" />
          </div>
          <div className="space-y-0.5">
            <p className="text-sm font-semibold">{label}</p>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </div>
        </div>
        <div className="min-w-0 flex-1 font-mono text-sm text-muted-foreground">
          {stored ? (
            <span title={`更新於 ${new Date(stored.updatedAt).toLocaleString("zh-HK")}`}>••••{stored.last4}</span>
          ) : (
            <span className="text-destructive">未設定</span>
          )}
        </div>
        {connected && (
          <Badge variant={CONNECTION_BADGE[connected].variant} className="shrink-0">
            {CONNECTION_BADGE[connected].text}
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="password"
          autoComplete="off"
          placeholder={stored ? "輸入新金鑰以替換" : "貼上 API 金鑰"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
          className="min-w-0 flex-1"
        />
        <Button size="sm" onClick={save} disabled={busy || value.trim().length === 0}>
          儲存
        </Button>
        <Button size="sm" variant="outline" onClick={test} disabled={busy || !stored}>
          測試
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={remove} disabled={busy || !stored}>
          刪除
        </Button>
        {msg && (
          <span className={`text-sm ${msg.kind === "ok" ? "text-muted-foreground" : "text-destructive"}`}>{msg.text}</span>
        )}
      </div>
    </div>
  );
}
