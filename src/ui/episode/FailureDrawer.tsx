"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { api, ApiClientError } from "@/ui/api";
import { failedTasksQuery, qk } from "@/ui/query-keys";
import { humanizeTaskError } from "@/lib/task/error-copy";
import type { BulkRetryResponse } from "@/ui/types";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export function FailureDrawer({
  episodeId,
  open,
  onOpenChange,
}: {
  episodeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<{ id: string; message: string } | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const query = useQuery({ ...failedTasksQuery(episodeId), enabled: open });
  const tasks = query.data ?? null;

  const retryMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/tasks/${id}/retry`),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.failedTasks(episodeId) }),
        queryClient.invalidateQueries({ queryKey: qk.episode(episodeId) }),
      ]);
    },
  });

  const bulkRetryMutation = useMutation({
    mutationFn: (taskIds: string[]) => api.post<BulkRetryResponse>("/api/tasks/retry-bulk", { taskIds }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.failedTasks(episodeId) }),
        queryClient.invalidateQueries({ queryKey: qk.episode(episodeId) }),
      ]);
    },
  });

  async function retry(id: string) {
    setRetrying(id);
    setRetryError(null);
    try {
      await retryMutation.mutateAsync(id);
    } catch (e) {
      setRetryError({ id, message: (e as ApiClientError).message });
    } finally {
      setRetrying(null);
    }
  }

  // Recoverable-terminal (key missing / wrong model) IS retryable — after the
  // user fixes the config. So 全部重試 includes them; only truly-terminal
  // failures (nothing the user can do) are excluded.
  const retryableTasks = (tasks ?? []).filter((t) => {
    const h = humanizeTaskError(t.errorCode, t.errorMessage);
    return !h.terminal || h.recoverable;
  });

  async function retryAll() {
    setBulkError(null);
    try {
      await bulkRetryMutation.mutateAsync(retryableTasks.map((t) => t.id));
    } catch (e) {
      setBulkError((e as ApiClientError).message);
    }
  }
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="text-card-foreground">
        <SheetHeader>
          <SheetTitle className="flex items-center justify-between gap-2 text-destructive">
            <span className="flex items-center gap-2">
              <AlertTriangle className="size-4" /> 失敗任務
            </span>
            {retryableTasks.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmAllOpen(true)}
                disabled={bulkRetryMutation.isPending}
              >
                {bulkRetryMutation.isPending ? <Loader2 className="animate-spin" /> : null}
                全部重試（{retryableTasks.length}）
              </Button>
            )}
          </SheetTitle>
          <ConfirmDialog
            open={confirmAllOpen}
            onOpenChange={setConfirmAllOpen}
            title={`重試 ${retryableTasks.length} 個任務？`}
            description="會重新排隊生成，可能產生費用。如果失敗原因（例如額度不足、未加金鑰）仲未修好，會再次失敗——請先確認已修正。"
            confirmLabel="確定重試"
            onConfirm={retryAll}
          />
          {bulkError && (
            <p className="text-xs text-destructive" aria-live="polite">
              批量重試失敗：{bulkError}
            </p>
          )}
        </SheetHeader>
        <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-4" aria-live="polite">
          {!tasks && <p className="text-sm text-muted-foreground">載入中…</p>}
          {tasks && tasks.length === 0 && <p className="text-sm text-muted-foreground">冇失敗任務 🎉</p>}
          {tasks?.map((t) => {
            const humanized = humanizeTaskError(t.errorCode, t.errorMessage);
            return (
              <div
                key={t.id}
                className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{t.type}</p>
                    <p className="text-sm text-destructive">{humanized.message}</p>
                    <p className="mt-0.5 text-xs break-words text-muted-foreground">
                      {t.errorCode ? `[${t.errorCode}] ` : ""}
                      {t.errorMessage ?? "未知錯誤"} · 第 {t.attempt} 次
                    </p>
                  </div>
                  {/* Recoverable-terminal: BOTH fix-the-config link AND retry
                      (the user fixes the cause, then retries). Truly-terminal:
                      only the action. Non-terminal: retry. */}
                  <div className="flex shrink-0 items-center gap-2">
                    {humanized.terminal && humanized.action && (
                      <Button asChild size="sm" variant="outline">
                        <Link href={humanized.action.href}>{humanized.action.label}</Link>
                      </Button>
                    )}
                    {(!humanized.terminal || humanized.recoverable) && (
                      <Button size="sm" variant="outline" onClick={() => retry(t.id)} disabled={retrying === t.id}>
                        {retrying === t.id ? <Loader2 className="animate-spin" /> : "重試"}
                      </Button>
                    )}
                    {humanized.terminal && !humanized.action && !humanized.recoverable && (
                      <Button asChild size="sm" variant="outline">
                        <Link href="/settings">去設定</Link>
                      </Button>
                    )}
                  </div>
                </div>
                {retryError?.id === t.id && (
                  <p className="text-xs text-destructive" aria-live="polite">
                    重試失敗：{retryError.message}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
