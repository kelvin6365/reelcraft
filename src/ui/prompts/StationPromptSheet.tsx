"use client";
// 進階模式 (advanced prompt mode) station sheet —「上次送出」(slice 2, readonly)
// +「編輯重跑」(slice 3, one-off override + resubmit).
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiClientError } from "@/ui/api";
import { lastPromptQuery, qk } from "@/ui/query-keys";
import { PROMPT_TASK } from "@/lib/prompts/prompt-task-map";
import type { LastPromptResponse, PromptRerunResponse, PromptSource } from "@/ui/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

// Friendlier labels for the promptId picker — kept static here rather than a
// round-trip to /api/prompts (slice 4), since this sheet only needs the
// handful of promptIds a station wires in via `promptIds`.
const PROMPT_LABEL: Record<string, string> = {
  extract_assets: "抽取資產",
  rewrite_script: "改寫劇本",
  script_review: "劇本體檢",
  build_scenes: "分場",
  storyboard_plan: "分鏡 · 規劃",
  storyboard_photography: "分鏡 · 運鏡",
  storyboard_acting: "分鏡 · 演技",
  storyboard_detail: "分鏡 · 細節",
  voice_analyze: "台詞分析",
};

const SOURCE_LABEL: Record<PromptSource, string> = {
  system: "系統",
  user: "個人",
  project: "專案",
  oneoff: "單次",
};

export function StationPromptSheet({
  episodeId,
  promptIds,
  open,
  onOpenChange,
}: {
  episodeId: string;
  promptIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [selected, setSelected] = useState(promptIds[0]);
  const promptId = promptIds.includes(selected) ? selected : promptIds[0];

  const query = useQuery({ ...lastPromptQuery(episodeId, promptId), enabled: open });
  const data = query.data ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="text-card-foreground sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span>{"<> Prompt"}</span>
            {promptIds.length > 1 ? (
              <Select value={promptId} onValueChange={setSelected}>
                <SelectTrigger size="sm" className="ml-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {promptIds.map((id) => (
                    <SelectItem key={id} value={id}>
                      {PROMPT_LABEL[id] ?? id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="ml-auto text-sm font-normal text-muted-foreground">
                {PROMPT_LABEL[promptId] ?? promptId}
              </span>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-4">
          <Tabs defaultValue="last-sent">
            <TabsList>
              <TabsTrigger value="last-sent">上次送出</TabsTrigger>
              <TabsTrigger value="edit-rerun">編輯重跑</TabsTrigger>
            </TabsList>
            <TabsContent value="last-sent" className="space-y-3">
              {query.isLoading && <Skeleton className="h-64 w-full" />}
              {query.error && <p className="text-sm text-destructive">{(query.error as Error).message}</p>}
              {data && <LastSentContent data={data} />}
            </TabsContent>
            <TabsContent value="edit-rerun" className="space-y-3">
              {query.isLoading && <Skeleton className="h-64 w-full" />}
              {query.error && <p className="text-sm text-destructive">{(query.error as Error).message}</p>}
              {data && (
                <EditRerunContent episodeId={episodeId} promptId={promptId} template={data.template} />
              )}
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function LastSentContent({ data }: { data: LastPromptResponse }) {
  const { log, template } = data;

  if (!log) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          呢集仲未跑過呢個 prompt。下面係目前生效嘅模板原文——未經變數代入，{"{變數}"} 係字面文字，唔係真正送出過嘅內容。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">來源：{SOURCE_LABEL[template.source]}</Badge>
          <Badge variant="outline">版本：{template.version}</Badge>
          {template.drifted && <Badge variant="destructive">已過時（base {template.baseVersion}）</Badge>}
        </div>
        <pre className="max-h-[60vh] overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
          {template.content}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline">模型：{log.modelKey}</Badge>
        <Badge variant="outline">版本：{log.promptVersion ?? "—"}</Badge>
        <Badge variant="outline">來源：{log.promptSource ? SOURCE_LABEL[log.promptSource] : "—"}</Badge>
        <Badge variant={log.status === "ok" ? "secondary" : "destructive"}>
          {log.status === "ok" ? "成功" : `失敗${log.errorCode ? ` (${log.errorCode})` : ""}`}
        </Badge>
        <span className="text-muted-foreground">{new Date(log.at).toLocaleString("zh-HK")}</span>
        {(log.inputTokens != null || log.outputTokens != null) && (
          <span className="text-muted-foreground">
            {log.inputTokens ?? "—"} in / {log.outputTokens ?? "—"} out
          </span>
        )}
        {log.estCostUsd != null && <span className="text-muted-foreground">~${log.estCostUsd.toFixed(4)}</span>}
      </div>
      <pre className="max-h-[60vh] overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
        {log.renderedPrompt ?? "（呢筆紀錄冇存全文）"}
      </pre>
    </div>
  );
}

// storyboard_plan/photography/acting/detail 共用一條 task，一個編輯過嘅 prompt
// 會套用喺嗰次 run 入面嘅每一個分鏡 —— 呢句提示唔可以省略，否則用戶會誤以為
// 只影響單一個鏡頭，出現「點解全部分鏡都變埋」嘅困惑 bug report。
const STORYBOARD_PROMPT_IDS = new Set([
  "storyboard_plan",
  "storyboard_photography",
  "storyboard_acting",
  "storyboard_detail",
]);

function EditRerunContent({
  episodeId,
  promptId,
  template,
}: {
  episodeId: string;
  promptId: string;
  template: LastPromptResponse["template"];
}) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState(template.content);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Switching promptId (multi-prompt stations) re-seeds from that prompt's own
  // template — never carry stale text across prompts.
  useEffect(() => {
    setContent(template.content);
    setError(null);
  }, [promptId, template.content]);

  const episodeScoped = PROMPT_TASK[promptId]?.scope === "episode";

  const rerun = useMutation({
    mutationFn: () =>
      api.post<PromptRerunResponse>(`/api/episodes/${episodeId}/prompt-rerun`, { promptId, content }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.episode(episodeId) }),
        queryClient.invalidateQueries({ queryKey: qk.lastPrompt(episodeId, promptId) }),
      ]);
    },
  });

  async function handleConfirm() {
    setError(null);
    try {
      await rerun.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : (err as Error).message);
      throw err; // keeps ConfirmDialog open so the user sees `error` and can retry
    }
  }

  return (
    <div className="space-y-3">
      <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
        <li>單次生效，唔會改模板</li>
        <li>{"{變數}"} 會喺生成時自動填入</li>
        {STORYBOARD_PROMPT_IDS.has(promptId) && <li>呢個 prompt 會套用喺呢次任務嘅每一個分鏡</li>}
        <li>會照正常計費</li>
      </ul>
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={16}
        disabled={!episodeScoped}
        className="font-mono text-xs"
      />
      {!episodeScoped && (
        <p className="text-sm text-muted-foreground">呢個 prompt 唔支援站內重跑。</p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={() => setConfirmOpen(true)} disabled={!episodeScoped || rerun.isPending}>
        改完重跑
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="用改咗嘅 prompt 重新生成？"
        description="單次生效，唔會改模板；會照正常計費。"
        confirmLabel="重新生成"
        onConfirm={handleConfirm}
      />
    </div>
  );
}
