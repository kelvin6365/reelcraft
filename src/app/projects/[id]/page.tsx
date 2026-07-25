"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { api, ApiClientError } from "@/ui/api";
import { PlanSetup } from "@/ui/planning/PlanSetup";
import { PlanReview } from "@/ui/planning/PlanReview";
import { ModelPicker } from "@/ui/planning/ModelPicker";
import { BatchPanel } from "@/ui/batch/BatchPanel";
import { ProjectFailurePanel } from "@/ui/episode/ProjectFailurePanel";
import { projectQuery } from "@/ui/query-keys";
import type { EpisodeListItem } from "@/ui/types";
import { ProviderReadinessBanner } from "@/ui/ProviderReadinessBanner";
import { ProjectPromptCard } from "@/ui/prompts/ProjectPromptCard";
import { useAdvancedMode } from "@/ui/prompts/useAdvancedMode";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  assets: "資產",
  script: "劇本",
  storyboard: "分鏡",
  images: "圖像",
  videos: "視頻",
  export: "成片",
  done: "已完成",
};

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [rawText, setRawText] = useState("");
  const [validationErr, setValidationErr] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [episodeDialogOpen, setEpisodeDialogOpen] = useState(false);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const { advancedMode } = useAdvancedMode();

  const {
    data: project,
    error: queryError,
  } = useQuery({
    ...projectQuery(id),
    refetchInterval: (query) => (query.state.data?.planStatus === "planning" ? 1500 : false),
  });

  useEffect(() => {
    if (queryError instanceof ApiClientError && queryError.code === "UNAUTHORIZED") {
      router.replace("/signin");
    }
  }, [queryError, router]);

  const loadErrMsg =
    queryError instanceof ApiClientError && queryError.code !== "UNAUTHORIZED" ? queryError.message : null;

  const createEpisodeMutation = useMutation({
    mutationFn: (text: string) => api.post<{ id: string }>(`/api/projects/${id}/episodes`, { rawText: text }),
    onSuccess: (ep) => router.push(`/projects/${id}/episodes/${ep.id}`),
  });

  const isSrt = project?.inputType === "srt";
  const planned = project?.planStatus === "planned";
  const episodes = project?.episodes ?? [];
  const hasEpisodes = episodes.length > 0;

  const busy = createEpisodeMutation.isPending;
  const mutationErrMsg = createEpisodeMutation.error
    ? (createEpisodeMutation.error as ApiClientError).message
    : null;

  function createEpisode() {
    if (!rawText.trim()) {
      setValidationErr(isSrt ? "請貼上 SRT 字幕。" : "請貼上小說原文。");
      return;
    }
    setValidationErr(null);
    createEpisodeMutation.mutate(rawText.trim());
  }

  function closeEpisodeDialog() {
    setEpisodeDialogOpen(false);
    setRawText("");
    setValidationErr(null);
  }

  if (!project && !loadErrMsg) {
    return <div className="flex min-h-svh items-center justify-center text-muted-foreground">載入中…</div>;
  }

  return (
    <AppShell active="projects" title={project?.name ?? "專案"}>
      <div className="space-y-6 p-8">
        <ProviderReadinessBanner projectId={id} />

        {loadErrMsg && <p className="text-sm text-destructive">{loadErrMsg}</p>}
        {project && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
              <Badge variant="secondary">{project.stylePackId}</Badge>
              <Badge variant="secondary">{project.videoRatio}</Badge>
            </div>

            <ProjectFailurePanel projectId={id} />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
              <div className="space-y-6">
                {/* ---------- episode planning (novels only) ---------- */}
                {!isSrt && (
                  <>
                    {!planned && episodes.length === 0 && (
                      <PlanSetup
                        id={id}
                        initialSourceText={project.sourceText}
                        initialTheme={(project as { theme?: string }).theme ?? ""}
                        initialConfig={project.planConfig}
                        planStatus={project.planStatus}
                      />
                    )}

                    {planned && project.planResult && (
                      hasEpisodes && !reviewOpen ? (
                        <Card>
                          <CardContent className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-3 text-sm">
                              <span className="font-medium">
                                已規劃 {project.planRisk?.total ?? project.planResult.episodes.length} 集
                              </span>
                              <span className="text-muted-foreground">🔴 {project.planRisk?.problem ?? 0}</span>
                              <span className="text-muted-foreground">🟡 {project.planRisk?.review ?? 0}</span>
                              <span className="text-muted-foreground">🟢 {project.planRisk?.ok ?? 0}</span>
                            </div>
                            <Button size="sm" variant="outline" onClick={() => setReviewOpen(true)}>
                              展開規劃
                            </Button>
                          </CardContent>
                        </Card>
                      ) : (
                        <PlanReview
                          id={id}
                          episodes={project.planResult.episodes}
                          risk={project.planRisk}
                          planConfig={project.planConfig}
                          hasEpisodes={hasEpisodes}
                        />
                      )
                    )}
                  </>
                )}

                {hasEpisodes && <BatchPanel id={id} episodes={episodes} />}

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-medium">劇集</h2>
                    <Button size="sm" variant="outline" onClick={() => setEpisodeDialogOpen(true)}>
                      ＋ 新增一集
                    </Button>
                  </div>
                  {episodes.length === 0 ? (
                    <Card>
                      <CardContent className="py-10 text-center text-sm text-muted-foreground">
                        仲未有劇集。喺上面規劃分集，或撳「＋ 新增一集」貼原文直接開一集。
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {episodes.map((ep: EpisodeListItem) => (
                        <Card key={ep.id} className="p-0 transition-colors hover:border-primary/40">
                          <Link
                            href={`/projects/${id}/episodes/${ep.id}`}
                            className="flex items-center justify-between gap-3 rounded-xl p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            <span className="font-medium">第 {ep.episodeNumber} 集</span>
                            <Badge variant="secondary">{STATUS_LABEL[ep.status] ?? ep.status}</Badge>
                          </Link>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-6">
                <Card className="p-0">
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-between rounded-xl px-4 py-3 font-medium"
                    onClick={() => setModelSettingsOpen((o) => !o)}
                  >
                    AI 模型設定
                    {modelSettingsOpen ? <ChevronUp /> : <ChevronDown />}
                  </Button>
                </Card>
                {modelSettingsOpen && (
                  <>
                    <ModelPicker
                      id={id}
                      modelDefaults={project.modelDefaults}
                      videoRatio={project.videoRatio}
                      videoResolution={project.videoResolution ?? "720p"}
                    />
                    {advancedMode && <ProjectPromptCard projectId={id} />}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <Dialog open={episodeDialogOpen} onOpenChange={(o) => !o && closeEpisodeDialog()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>新增一集</DialogTitle>
            <DialogDescription>
              {isSrt
                ? "貼上 SRT 字幕，系統會按字幕逐句建立分鏡與配音，然後帶你行流程。"
                : "唔想規劃整部小說？貼上單集原文，系統會直接建立一集帶你行八站流程。"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              rows={8}
              placeholder={isSrt ? "喺呢度貼上 SRT 字幕內容…" : "喺呢度貼上小說章節原文…"}
              aria-invalid={validationErr ? true : undefined}
            />
            {validationErr && <p className="text-sm text-destructive">{validationErr}</p>}
          </div>
          <DialogFooter>
            {mutationErrMsg && <p className="text-sm text-destructive">建立呢一集失敗：{mutationErrMsg}</p>}
            <Button variant="ghost" onClick={closeEpisodeDialog} disabled={busy}>
              取消
            </Button>
            <Button onClick={createEpisode} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              建立這一集
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
