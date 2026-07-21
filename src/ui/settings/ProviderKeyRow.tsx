"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Cloud, Eye, EyeOff, Globe, XCircle, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, ApiClientError } from "@/ui/api";
import { qk } from "@/ui/query-keys";
import type { ConnectionStatus, ProviderKeyView } from "@/ui/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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

// Only providers with a publicly documented, stable key prefix are validated
// here — guessing at undocumented formats would just produce false negatives.
const KEY_PREFIX_RULES: Record<string, { prefix: string; label: string }> = {
  openrouter: { prefix: "sk-or-", label: "OpenRouter" },
};

function formatError(provider: string, trimmed: string): string | null {
  const rule = KEY_PREFIX_RULES[provider];
  if (rule && !trimmed.startsWith(rule.prefix)) {
    return `呢條唔似係 ${rule.label} 金鑰（應以 ${rule.prefix} 開頭）`;
  }
  return null;
}

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
  const [showKey, setShowKey] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const saveMutation = useMutation({
    mutationFn: (apiKey: string) => api.put("/api/user/provider-keys", { provider, apiKey }),
    onSuccess: () => {
      setValue("");
      setShowKey(false);
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
  const hasUnsavedValue = value.trim().length > 0;

  function save() {
    const trimmed = value.trim();
    if (trimmed.length < 8) {
      setMsg({ kind: "err", text: "金鑰太短（至少 8 字元）" });
      return;
    }
    const fErr = formatError(provider, trimmed);
    if (fErr) {
      setMsg({ kind: "err", text: fErr });
      return;
    }
    setMsg(null);
    saveMutation.mutate(trimmed);
  }

  function remove() {
    setConfirmOpen(false);
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
        <div className="relative min-w-0 flex-1">
          <Input
            type={showKey ? "text" : "password"}
            autoComplete="off"
            placeholder={stored ? "輸入新金鑰以替換" : "貼上 API 金鑰"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
            className="pr-9"
          />
          <button
            type="button"
            onClick={() => setShowKey((s) => !s)}
            disabled={busy || value.length === 0}
            aria-label={showKey ? "隱藏金鑰" : "顯示金鑰"}
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <Button size="sm" onClick={save} disabled={busy || value.trim().length === 0}>
          儲存
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={test}
          disabled={busy || !stored}
          title={hasUnsavedValue ? "測試只會用已儲存嘅金鑰" : undefined}
        >
          測試
        </Button>
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy || !stored}>
              刪除
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>刪除 {label} 金鑰？</AlertDialogTitle>
              <AlertDialogDescription>刪除後使用該供應商嘅模型會即時失效。呢個操作無法復原。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={remove}>
                確認刪除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {hasUnsavedValue && (
          <span className="text-xs text-muted-foreground">測試只會用已儲存嘅金鑰，先儲存先可以測試新金鑰</span>
        )}
        {msg && (
          <span
            role="status"
            aria-live="polite"
            className={`inline-flex items-center gap-1 text-sm ${msg.kind === "ok" ? "text-muted-foreground" : "text-destructive"}`}
          >
            {msg.kind === "ok" ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
