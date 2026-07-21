"use client";
// Project-layer prompt overrides card (Slice 5), mounted as a ModelPicker
// sibling in the project detail sidebar, gated on advancedMode. Lists the 11
// catalog prompts with this project's 生效層 badge; clicking a row opens the
// shared PromptEditor with projectId set, so saves write the project layer —
// which only ever shadows this project, never the user's personal override.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { promptQuery, promptsQuery, qk } from "@/ui/query-keys";
import type { PromptDetailView, PromptSource, PromptStatusView } from "@/ui/types";
import { PromptEditor } from "@/ui/prompts/PromptEditor";
import { DriftBadge } from "@/ui/prompts/PromptDiff";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const LAYER_LABEL: Record<PromptSource, string> = {
  system: "系統",
  user: "個人",
  project: "本專案",
  oneoff: "本專案",
};

function LayerBadge({ row }: { row: PromptStatusView }) {
  const variant = row.source === "project" ? "secondary" : row.source === "user" ? "outline" : "outline";
  return <Badge variant={variant}>{LAYER_LABEL[row.source]}</Badge>;
}

export function ProjectPromptCard({ projectId }: { projectId: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const listQuery = useQuery(promptsQuery(projectId));

  if (selected) {
    return <ProjectPromptDetail promptId={selected} projectId={projectId} onBack={() => setSelected(null)} />;
  }

  return (
    <Card className="py-0">
      <CardHeader className="py-6">
        <CardTitle className="text-base">Prompt 模板 — 本專案</CardTitle>
        <p className="text-sm text-muted-foreground">
          未覆寫嘅維持個人層或官方版；喺呢度改只影響呢個專案。
        </p>
      </CardHeader>
      <CardContent className="space-y-1 pb-6">
        {listQuery.isLoading && <Skeleton className="h-48 w-full" />}
        {listQuery.error && <p className="text-sm text-destructive">{(listQuery.error as Error).message}</p>}
        {listQuery.data?.map((row, i) => (
          <div
            key={row.promptId}
            role="button"
            tabIndex={0}
            onClick={() => setSelected(row.promptId)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setSelected(row.promptId);
            }}
            className={`flex w-full cursor-pointer items-center justify-between gap-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              listQuery.data && i < listQuery.data.length - 1 ? "border-b" : ""
            }`}
          >
            <p className="min-w-0 truncate text-sm">{row.description}</p>
            <div className="flex shrink-0 items-center gap-1.5">
              {row.drifted ? <DriftBadge row={row} projectId={projectId} /> : <LayerBadge row={row} />}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ProjectPromptDetail({
  promptId,
  projectId,
  onBack,
}: {
  promptId: string;
  projectId: string;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery(promptQuery(promptId, projectId));

  function invalidate(next: PromptDetailView) {
    queryClient.setQueryData(qk.prompt(promptId, projectId), next);
    void queryClient.invalidateQueries({ queryKey: qk.prompts(projectId) });
  }

  return (
    <Card className="py-0">
      <CardHeader className="flex-row items-center gap-2 py-6">
        <Button type="button" variant="ghost" size="icon" onClick={onBack} aria-label="返回清單">
          <ChevronLeft className="size-4" />
        </Button>
        <div className="min-w-0 space-y-1">
          <h2 className="truncate text-base font-semibold">{detailQuery.data?.description ?? promptId}</h2>
          <p className="truncate text-xs text-muted-foreground">{promptId} · 本專案層</p>
        </div>
      </CardHeader>
      <CardContent className="pb-6">
        {detailQuery.isLoading && <Skeleton className="h-72 w-full" />}
        {detailQuery.error && <p className="text-sm text-destructive">{(detailQuery.error as Error).message}</p>}
        {detailQuery.data && (
          <PromptEditor
            promptId={promptId}
            projectId={projectId}
            detail={detailQuery.data}
            onSaved={invalidate}
            onReverted={invalidate}
          />
        )}
      </CardContent>
    </Card>
  );
}
