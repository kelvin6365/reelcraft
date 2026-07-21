"use client";
// User-layer Prompt 模板 tab (settings page, advanced mode only). List of the
// 11 catalog prompts with each row's effective source + override badges;
// click a row to drill into the shared PromptEditor.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { promptQuery, promptsQuery, qk } from "@/ui/query-keys";
import type { PromptDetailView, PromptStatusView } from "@/ui/types";
import { PromptEditor } from "@/ui/prompts/PromptEditor";
import { DriftBadge } from "@/ui/prompts/PromptDiff";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function StatusBadge({ row }: { row: PromptStatusView }) {
  if (row.drifted) return <DriftBadge row={row} />;
  if (row.hasUserOverride) return <Badge variant="secondary">已自訂 · 基於 v{row.baseVersion}</Badge>;
  return <Badge variant="outline">官方版</Badge>;
}

export function PromptTemplatesTab() {
  const [selected, setSelected] = useState<string | null>(null);
  const listQuery = useQuery(promptsQuery());

  if (selected) {
    return <PromptTemplateDetail promptId={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <Card className="py-0">
      <CardHeader className="py-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Prompt 模板 — 個人層</h2>
          <p className="text-sm text-muted-foreground">
            覆寫任何一個 pipeline prompt；未覆寫嘅維持官方版，官方升版後仍然生效。
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-1 pb-6">
        {listQuery.isLoading && <Skeleton className="h-64 w-full" />}
        {listQuery.error && <p className="text-sm text-destructive">{(listQuery.error as Error).message}</p>}
        {listQuery.data?.map((row, i) => (
          // A row-level <button> can't be used here: StatusBadge renders its
          // own <button> (the drift diff trigger) and nested buttons are
          // invalid HTML — role="button" + keyboard handling instead.
          <div
            key={row.promptId}
            role="button"
            tabIndex={0}
            onClick={() => setSelected(row.promptId)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setSelected(row.promptId);
            }}
            className={`flex w-full cursor-pointer items-center justify-between gap-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              i < listQuery.data.length - 1 ? "border-b" : ""
            }`}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{row.description}</p>
              <p className="truncate text-xs text-muted-foreground">{row.promptId}</p>
            </div>
            <StatusBadge row={row} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PromptTemplateDetail({ promptId, onBack }: { promptId: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery(promptQuery(promptId));

  function invalidate(next: PromptDetailView) {
    queryClient.setQueryData(qk.prompt(promptId, undefined), next);
    void queryClient.invalidateQueries({ queryKey: qk.prompts(undefined) });
  }

  return (
    <Card className="py-0">
      <CardHeader className="flex-row items-center gap-2 py-6">
        <Button type="button" variant="ghost" size="icon" onClick={onBack} aria-label="返回清單">
          <ChevronLeft className="size-4" />
        </Button>
        <div className="min-w-0 space-y-1">
          <h2 className="truncate text-lg font-semibold">{detailQuery.data?.description ?? promptId}</h2>
          <p className="truncate text-xs text-muted-foreground">{promptId}</p>
        </div>
      </CardHeader>
      <CardContent className="pb-6">
        {detailQuery.isLoading && <Skeleton className="h-96 w-full" />}
        {detailQuery.error && <p className="text-sm text-destructive">{(detailQuery.error as Error).message}</p>}
        {detailQuery.data && (
          <PromptEditor
            promptId={promptId}
            detail={detailQuery.data}
            onSaved={invalidate}
            onReverted={invalidate}
          />
        )}
      </CardContent>
    </Card>
  );
}
