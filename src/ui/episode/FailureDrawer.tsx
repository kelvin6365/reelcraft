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

  const retryableTasks = (tasks ?? []).filter((t) => !humanizeTaskError(t.errorCode, t.errorMessage).terminal);

  async function retryAll() {
    setBulkError(null);
    try {
      await bulkRetryMutation.mutateAsync(retryableTasks.map((t) => t.id));
    } catch (e) {
      setBulkError((e as ApiClientError).message);
    }
  }

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
                onClick={retryAll}
                disabled={bulkRetryMutation.isPending}
              >
                {bulkRetryMutation.isPending ? <Loader2 className="animate-spin" /> : null}
                全部重試（{retryableTasks.length}）
              </Button>
            )}
          </SheetTitle>
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
                  {humanized.terminal ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={humanized.action?.href ?? "/settings"}>{humanized.action?.label ?? "去設定"}</Link>
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => retry(t.id)} disabled={retrying === t.id}>
                      {retrying === t.id ? <Loader2 className="animate-spin" /> : "一鍵重試"}
                    </Button>
                  )}
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
