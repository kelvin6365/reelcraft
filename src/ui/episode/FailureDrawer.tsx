"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { api, ApiClientError } from "@/ui/api";
import { failedTasksQuery, qk } from "@/ui/query-keys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export function FailureDrawer({ episodeId, failedCount }: { episodeId: string; failedCount: number }) {
  const [open, setOpen] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
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

  async function retry(id: string) {
    setRetrying(id);
    try {
      await retryMutation.mutateAsync(id);
    } catch (e) {
      alert((e as ApiClientError).message);
    } finally {
      setRetrying(null);
    }
  }

  if (failedCount === 0 && !open) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        variant="destructive"
        className="fixed right-6 bottom-6 z-40 shadow-lg"
        onClick={() => setOpen((o) => !o)}
      >
        <AlertTriangle /> 失敗任務
        {failedCount > 0 && (
          <Badge variant="secondary" className="ml-1 bg-white/20 text-current">
            {failedCount}
          </Badge>
        )}
      </Button>
      <SheetContent side="right" className="text-card-foreground">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-4" /> 失敗任務
          </SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-4">
          {!tasks && <p className="text-sm text-muted-foreground">載入中…</p>}
          {tasks && tasks.length === 0 && <p className="text-sm text-muted-foreground">冇失敗任務 🎉</p>}
          {tasks?.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold">{t.type}</p>
                <p className="text-xs break-words text-muted-foreground">
                  {t.errorCode ? `[${t.errorCode}] ` : ""}
                  {t.errorMessage ?? "未知錯誤"} · 第 {t.attempt} 次
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => retry(t.id)} disabled={retrying === t.id}>
                {retrying === t.id ? <Loader2 className="animate-spin" /> : "一鍵重試"}
              </Button>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
