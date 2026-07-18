"use client";
import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/ui/api";
import type { FailedTask } from "@/ui/types";

export function FailureDrawer({
  episodeId,
  failedCount,
  onChange,
}: {
  episodeId: string;
  failedCount: number;
  onChange: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<FailedTask[] | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  async function load() {
    try {
      const t = await api.get<FailedTask[]>(`/api/tasks?episodeId=${episodeId}&status=failed`);
      setTasks(t);
    } catch {
      setTasks([]);
    }
  }

  useEffect(() => {
    if (open) void load();
  }, [open, failedCount]);

  async function retry(id: string) {
    setRetrying(id);
    try {
      await api.post(`/api/tasks/${id}/retry`);
      await load();
      await onChange();
    } catch (e) {
      alert((e as ApiClientError).message);
    } finally {
      setRetrying(null);
    }
  }

  if (failedCount === 0 && !open) return null;

  return (
    <>
      <button className="fail-fab" onClick={() => setOpen((o) => !o)}>
        失敗任務
        {failedCount > 0 && <span className="fail-badge">{failedCount}</span>}
      </button>
      {open && (
        <div className="drawer">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <h3 style={{ fontSize: 16 }}>失敗任務</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
              關閉
            </button>
          </div>
          {!tasks && <p className="muted">載入中…</p>}
          {tasks && tasks.length === 0 && <p className="muted">冇失敗任務 🎉</p>}
          {tasks?.map((t) => (
            <div key={t.id} className="fail-row">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{t.type}</div>
                <div className="faint" style={{ fontSize: 12, wordBreak: "break-word" }}>
                  {t.errorCode ? `[${t.errorCode}] ` : ""}
                  {t.errorMessage ?? "未知錯誤"} · 第 {t.attempt} 次
                </div>
              </div>
              <button className="btn btn-sm" onClick={() => retry(t.id)} disabled={retrying === t.id}>
                {retrying === t.id ? <span className="spinner" /> : "一鍵重試"}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
