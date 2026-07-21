"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api, ApiClientError } from "@/ui/api";
import { PlanSetup } from "@/ui/planning/PlanSetup";
import { PlanReview } from "@/ui/planning/PlanReview";
import { ModelPicker } from "@/ui/planning/ModelPicker";
import { BatchPanel } from "@/ui/batch/BatchPanel";
import { projectQuery } from "@/ui/query-keys";
import type { EpisodeListItem } from "@/ui/types";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  const err = loadErrMsg ?? validationErr ?? mutationErrMsg;

  function createEpisode() {
    if (!rawText.trim()) {
      setValidationErr(isSrt ? "請貼上 SRT 字幕。" : "請貼上小說原文。");
      return;
    }
    setValidationErr(null);
    createEpisodeMutation.mutate(rawText.trim());
  }

  if (!project && !err) {
    return <div className="flex min-h-svh items-center justify-center text-muted-foreground">載入中…</div>;
  }

  return (
    <AppShell active="projects" title={project?.name ?? "專案"}>
      <div className="space-y-6 p-8">
        {err && <p className="text-sm text-destructive">{err}</p>}
        {project && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
              <Badge variant="secondary">{project.stylePackId}</Badge>
              <Badge variant="secondary">{project.videoRatio}</Badge>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_340px]">
              <div className="space-y-6">
                {/* ---------- episode planning (novels only) ---------- */}
                {!isSrt && (
                  <>
                    {!planned && (
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

                {/* ---------- manual single-episode create (legacy path kept) ---------- */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">新增一集</CardTitle>
                    <CardDescription>
                      {isSrt
                        ? "貼上 SRT 字幕，系統會按字幕逐句建立分鏡與配音，然後帶你行流程。"
                        : "唔想規劃整部小說？貼上單集原文，系統會直接建立一集帶你行八站流程。"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      value={rawText}
                      onChange={(e) => setRawText(e.target.value)}
                      rows={8}
                      placeholder={isSrt ? "喺呢度貼上 SRT 字幕內容…" : "喺呢度貼上小說章節原文…"}
                    />
                  </CardContent>
                  <CardFooter className="justify-end border-t">
                    <Button onClick={createEpisode} disabled={busy}>
                      {busy && <Loader2 className="animate-spin" />}
                      建立這一集
                    </Button>
                  </CardFooter>
                </Card>

                {hasEpisodes && <BatchPanel id={id} episodes={episodes} />}

                <div className="space-y-4">
                  <h2 className="text-lg font-medium">劇集</h2>
                  {episodes.length === 0 ? (
                    <Card>
                      <CardContent className="py-10 text-center text-sm text-muted-foreground">
                        仲未有劇集。喺上面規劃分集或貼原文建立第一集。
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {episodes.map((ep: EpisodeListItem) => (
                        <Card
                          key={ep.id}
                          className="cursor-pointer transition-colors hover:border-primary/40"
                          onClick={() => router.push(`/projects/${id}/episodes/${ep.id}`)}
                        >
                          <CardContent className="flex items-center justify-between">
                            <span className="font-medium">第 {ep.episodeNumber} 集</span>
                            <Badge variant="secondary">{STATUS_LABEL[ep.status] ?? ep.status}</Badge>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-6">
                <ModelPicker
                  id={id}
                  modelDefaults={project.modelDefaults}
                  videoRatio={project.videoRatio}
                  videoResolution={project.videoResolution ?? "720p"}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
