"use client";
// Three-pane drift diff: 你嘅版本 / 你改嗰陣嘅官方版 (baseContent) / 目前官方版.
// baseContent is the only way to recover what the user actually started from —
// the system file gets overwritten in place on every catalog upgrade.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitCompare } from "lucide-react";
import { promptQuery } from "@/ui/query-keys";
import type { PromptStatusView } from "@/ui/types";
import { diffLines } from "@/lib/prompts/diff";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

function DiffPane({
  title,
  content,
  against,
}: {
  title: string;
  content: string;
  against: string | null;
}) {
  const lines = against === null ? content.split("\n").map((text) => ({ type: "same" as const, text })) : diffLines(against, content);
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <div className="max-h-96 overflow-x-auto overflow-y-auto rounded-md border bg-muted/30">
        <pre className="min-w-full whitespace-pre p-2 font-mono text-[11px] leading-5">
          {lines.map((line, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no stable identity
              key={i}
              className={
                line.type === "add"
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                  : line.type === "del"
                    ? "bg-red-500/15 text-red-700 dark:text-red-400"
                    : undefined
              }
            >
              {line.text || " "}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

export function PromptDiff({
  yourContent,
  baseContent,
  systemContent,
  version,
}: {
  yourContent: string;
  baseContent: string;
  systemContent: string;
  version: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline">目前官方版本：{version}</Badge>
      </div>
      <div className="grid gap-4 overflow-x-auto sm:grid-cols-3">
        <DiffPane title="你嘅版本" content={yourContent} against={baseContent} />
        <DiffPane title="你改嗰陣嘅官方版" content={baseContent} against={null} />
        <DiffPane title={`目前官方版 v${version}`} content={systemContent} against={baseContent} />
      </div>
    </div>
  );
}

// Drift badge + a lazy diff dialog trigger — shared by the user-layer list
// (PromptTemplatesTab) and the project-layer card (ProjectPromptCard) so both
// surface drift the same way without either needing the full editor open.
export function DriftBadge({
  row,
  projectId,
}: {
  row: PromptStatusView;
  projectId?: string;
}) {
  const [open, setOpen] = useState(false);
  const detailQuery = useQuery({ ...promptQuery(row.promptId, projectId), enabled: open });

  if (!row.drifted) return null;

  const layer = projectId ? detailQuery.data?.project : detailQuery.data?.user;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto gap-1 px-1.5 py-0.5 text-destructive"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Badge variant="destructive">
          基於 v{row.baseVersion} · 官方已更新到 v{row.version}
        </Badge>
        <GitCompare className="size-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Prompt 差異 — {row.description}</DialogTitle>
          </DialogHeader>
          {detailQuery.isLoading && <Skeleton className="h-64 w-full" />}
          {layer && detailQuery.data && (
            <PromptDiff
              yourContent={layer.content}
              baseContent={layer.baseContent}
              systemContent={detailQuery.data.system}
              version={detailQuery.data.version}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
