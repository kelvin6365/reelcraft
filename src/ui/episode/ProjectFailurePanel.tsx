"use client";
// Project-level failure overview — a destructive-tinted card near the top of
// /projects/:id, only rendered when the project has failed tasks. Groups rows
// by episode (same data source as the per-episode FailureDrawer) and offers
// single / per-episode / global retry, all going through the shared
// POST /api/tasks/retry-bulk endpoint.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { api, ApiClientError } from "@/ui/api";
import { projectFailedTasksQuery, qk } from "@/ui/query-keys";
import { humanizeTaskError } from "@/lib/task/error-copy";
import type { BulkRetryResponse, ProjectFailedTask } from "@/ui/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ProjectFailurePanel({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkBusyKey, setBulkBusyKey] = useState<string | null>(null); // "all" | episodeId
  const queryClient = useQueryClient();

  const query = useQuery(projectFailedTasksQuery(projectId));
  const tasks = query.data ?? [];

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.projectFailedTasks(projectId) }),
      queryClient.invalidateQueries({ queryKey: qk.project(projectId) }),
    ]);

  const retryMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/tasks/${id}/retry`),
    onSuccess: invalidate,
  });

  const bulkRetryMutation = useMutation({
    mutationFn: (taskIds: string[]) => api.post<BulkRetryResponse>("/api/tasks/retry-bulk", { taskIds }),
    onSuccess: invalidate,
  });

  if (!query.data || tasks.length === 0) return null;

  async function retryOne(id: string) {
    setRetrying(id);
    setRowError(null);
    try {
      await retryMutation.mutateAsync(id);
    } catch (e) {
      setRowError({ id, message: (e as ApiClientError).message });
    } finally {
      setRetrying(null);
    }
  }

  async function retryMany(key: string, taskIds: string[]) {
    setBulkBusyKey(key);
    setBulkError(null);
    try {
      await bulkRetryMutation.mutateAsync(taskIds);
    } catch (e) {
      setBulkError((e as ApiClientError).message);
    } finally {
      setBulkBusyKey(null);
    }
  }

  function isRetryable(t: ProjectFailedTask) {
    return !humanizeTaskError(t.errorCode, t.errorMessage).terminal;
  }

  const retryableAll = tasks.filter(isRetryable);

  const byEpisode = new Map<string, ProjectFailedTask[]>();
  for (const t of tasks) {
    const key = t.episodeId ?? "unknown";
    byEpisode.set(key, [...(byEpisode.get(key) ?? []), t]);
  }
  const groups = [...byEpisode.entries()].sort((a, b) => {
    const an = a[1][0]?.episodeNumber ?? 0;
    const bn = b[1][0]?.episodeNumber ?? 0;
    return an - bn;
  });

  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="size-4" /> {tasks.length} 個失敗任務
        </CardTitle>
        <div className="flex items-center gap-2">
          {retryableAll.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => retryMany("all", retryableAll.map((t) => t.id))}
              disabled={bulkRetryMutation.isPending}
            >
              {bulkBusyKey === "all" ? <Loader2 className="animate-spin" /> : null}
              全部重試（{retryableAll.length}）
            </Button>
          )}
          <Button size="icon" variant="ghost" onClick={() => setOpen((o) => !o)} aria-label={open ? "收起" : "展開"}>
            {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </Button>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          {bulkError && (
            <p className="text-xs text-destructive" aria-live="polite">
              批量重試失敗：{bulkError}
            </p>
          )}
          {groups.map(([episodeId, episodeTasks]) => {
            const episodeNumber = episodeTasks[0]?.episodeNumber;
            const episodeRetryable = episodeTasks.filter(isRetryable);
            return (
              <div key={episodeId} className="space-y-2 rounded-lg border border-destructive/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <Link
                    href={episodeId === "unknown" ? "#" : `/projects/${projectId}/episodes/${episodeId}`}
                    className="text-sm font-semibold hover:underline"
                  >
                    {episodeNumber ? `第 ${episodeNumber} 集` : "未知集數"}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      （{episodeTasks.length} 個失敗）
                    </span>
                  </Link>
                  {episodeRetryable.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => retryMany(episodeId, episodeRetryable.map((t) => t.id))}
                      disabled={bulkRetryMutation.isPending}
                    >
                      {bulkBusyKey === episodeId ? <Loader2 className="animate-spin" /> : null}
                      本集全部重試
                    </Button>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {episodeTasks.map((t) => {
                    const humanized = humanizeTaskError(t.errorCode, t.errorMessage);
                    return (
                      <div
                        key={t.id}
                        className="flex items-center justify-between gap-3 rounded-md bg-background/60 p-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{t.type}</p>
                          <p className="text-sm text-destructive">{humanized.message}</p>
                          {rowError?.id === t.id && (
                            <p className="text-xs text-destructive" aria-live="polite">
                              重試失敗：{rowError.message}
                            </p>
                          )}
                        </div>
                        {humanized.terminal ? (
                          <Button asChild size="sm" variant="outline">
                            <Link href={humanized.action?.href ?? "/settings"}>
                              {humanized.action?.label ?? "去設定"}
                            </Link>
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => retryOne(t.id)}
                            disabled={retrying === t.id}
                          >
                            {retrying === t.id ? <Loader2 className="animate-spin" /> : "重試"}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">共 {tasks.length} 個</Badge>
            <Badge variant="secondary">可重試 {retryableAll.length} 個</Badge>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
