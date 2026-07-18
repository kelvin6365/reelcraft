"use client";
import { useState } from "react";
import { api, ApiClientError } from "@/ui/api";
import type { ProviderKeyView } from "@/ui/types";

// One provider's key row: masked display (••••last4) when stored, a password
// field to set/replace, plus 測試 and 刪除. The plaintext never leaves this
// input — it's POSTed once and cleared.
export function ProviderKeyRow({
  provider,
  label,
  hint,
  stored,
  onChanged,
}: {
  provider: string;
  label: string;
  hint: string;
  stored: ProviderKeyView | undefined;
  onChanged: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function save() {
    if (value.trim().length < 8) {
      setMsg({ kind: "err", text: "金鑰太短（至少 8 字元）" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await api.put("/api/user/provider-keys", { provider, apiKey: value.trim() });
      setValue("");
      setMsg({ kind: "ok", text: "已儲存" });
      onChanged();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiClientError ? e.message : "儲存失敗" });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setMsg(null);
    try {
      await api.del("/api/user/provider-keys", { provider });
      setMsg({ kind: "ok", text: "已刪除" });
      onChanged();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiClientError ? e.message : "刪除失敗" });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.post<{ ok: boolean }>("/api/user/provider-keys/test", { provider });
      setMsg(res.ok ? { kind: "ok", text: "金鑰有效" } : { kind: "err", text: "金鑰無效或未設定" });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof ApiClientError ? e.message : "測試失敗" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <strong>{label}</strong>
        {stored ? (
          <span className="badge" title={`更新於 ${new Date(stored.updatedAt).toLocaleString("zh-HK")}`}>
            ••••{stored.last4}
          </span>
        ) : (
          <span className="muted">未設定</span>
        )}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {hint}
      </p>
      <div className="row" style={{ gap: 8 }}>
        <input
          type="password"
          autoComplete="off"
          placeholder={stored ? "輸入新金鑰以替換" : "貼上 API 金鑰"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button className="btn btn-primary btn-sm" onClick={save} disabled={busy || value.trim().length === 0}>
          儲存
        </button>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-ghost btn-sm" onClick={test} disabled={busy || !stored}>
          測試
        </button>
        <button className="btn btn-danger btn-sm" onClick={remove} disabled={busy || !stored}>
          刪除
        </button>
        {msg && (
          <span className={msg.kind === "ok" ? "muted" : "error-text"} style={{ fontSize: 13 }}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
