"use client";
// 專案總覽 — rebuilt to the Pencil ref (frame nfIj9): metric cards, projects
// table with status badges, sidebar shell. Data layer is TanStack Query.
import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { ApiClientError } from "@/ui/api";
import { useSession } from "@/ui/auth-client";
import { balanceQuery, projectsQuery, usageQuery } from "@/ui/query-keys";
import type { ProjectSummary } from "@/ui/types";
import { STATUS_STATION_INDEX, continueLabel, stationIndexOf } from "@/ui/episode/status";
import { DRAFT_KEY, defaultDraft } from "@/ui/wizard/draft";
import { SAMPLE_NOVEL } from "@/lib/fixtures/sample-novel";
import { ProviderReadinessBanner } from "@/ui/ProviderReadinessBanner";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const STATION_COUNT = Object.keys(STATUS_STATION_INDEX).length;

function projectStatus(p: ProjectSummary): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  if (p.episodes.length === 0) return { label: "草稿", variant: "outline" };
  if (p.episodes.every((e) => e.status === "done")) return { label: "已完成", variant: "secondary" };
  return { label: "進行中", variant: "default" };
}

// 揀專案入面最近更新嘅一集，用嚟畫進度點。冇集就 undefined。
function latestEpisode(p: ProjectSummary) {
  return p.episodes.reduce<ProjectSummary["episodes"][number] | undefined>((latest, e) => {
    if (!latest) return e;
    if (!e.updatedAt) return latest;
    if (!latest.updatedAt) return e;
    return e.updatedAt > latest.updatedAt ? e : latest;
  }, undefined);
}

function StationDots({ status }: { status: string }) {
  const idx = stationIndexOf(status);
  const allDone = status === "done";
  return (
    <div className="flex items-center gap-1" title={continueLabel(status)}>
      {Array.from({ length: STATION_COUNT }, (_, i) => {
        const dotNum = i + 1;
        const filled = allDone || dotNum < idx;
        const isCurrent = !allDone && dotNum === idx;
        return (
          <span
            key={dotNum}
            className={cn(
              "size-1.5 rounded-full",
              filled ? "bg-primary" : "bg-muted",
              isCurrent && "ring-2 ring-primary/40",
            )}
          />
        );
      })}
    </div>
  );
}

export default function ProjectsPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  useEffect(() => {
    if (isPending) return;
    if (!session) router.replace("/signin");
  }, [isPending, session, router]);

  const enabled = !isPending && !!session;
  const { data: projects, error, isLoading } = useQuery({ ...projectsQuery(), enabled });
  const { data: usageDay } = useQuery({ ...usageQuery("day"), enabled });
  const { data: balance } = useQuery({ ...balanceQuery(), enabled });
  const loadErr = error ? (error as ApiClientError).message : null;

  const chips = useMemo(() => {
    if (!projects) return null;
    const totalEpisodes = projects.reduce((n, p) => n + p.episodes.length, 0);
    const done = projects.reduce((n, p) => n + p.episodes.filter((e) => e.status === "done").length, 0);
    return {
      projectCount: projects.length,
      totalEpisodes,
      done,
    };
  }, [projects]);

  const continueCard = useMemo(() => {
    if (!projects) return null;
    const pairs = projects.flatMap((p) => p.episodes.map((e) => ({ p, e })));
    const withUpdated = pairs.filter((x) => x.e.updatedAt);
    if (withUpdated.length === 0) return null;
    return withUpdated.reduce((latest, cur) => (cur.e.updatedAt! > latest.e.updatedAt! ? cur : latest));
  }, [projects]);

  if (isPending || !session) {
    return <div className="flex min-h-svh items-center justify-center text-muted-foreground">載入中…</div>;
  }

  const startSample = () => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...defaultDraft(), text: SAMPLE_NOVEL }));
    router.push("/projects/new");
  };

  return (
    <AppShell
      active="projects"
      title="專案總覽"
      actions={
        <Button size="sm" asChild>
          <Link href="/projects/new">
            <Plus /> 新專案
          </Link>
        </Button>
      }
    >
      <div className="space-y-6 p-8">
        <ProviderReadinessBanner />

        {loadErr && <p className="text-sm text-destructive">{loadErr}</p>}

        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : projects && projects.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-24 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">貼一段小說，AI 幫你出一集短劇</h1>
            <p className="max-w-md text-sm text-muted-foreground">
              三步搞掂：貼故事、揀畫風、揀出法。八站流程全程睇住進度。
            </p>
            <Button size="lg" asChild>
              <Link href="/projects/new">
                <Plus /> 開始製作
              </Link>
            </Button>
            <button
              type="button"
              onClick={startSample}
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              或者用範例小說試下 →
            </button>
          </div>
        ) : projects ? (
          <>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">專案總覽</h1>
              <p className="mt-1 text-sm text-muted-foreground">貼一段小說，行八站流程出一集短劇。</p>
            </div>

            {continueCard && (
              <Card className="border-primary/40">
                <CardContent className="flex items-center justify-between gap-4 py-4">
                  <div>
                    <p className="font-medium">
                      {continueCard.p.name} · 第 {continueCard.e.episodeNumber} 集
                    </p>
                    <p className="text-sm text-muted-foreground">{continueLabel(continueCard.e.status)}</p>
                  </div>
                  <Button asChild>
                    <Link href={`/projects/${continueCard.p.id}/episodes/${continueCard.e.id}`}>繼續 →</Link>
                  </Button>
                </CardContent>
              </Card>
            )}

            {chips && (
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{chips.projectCount} 個專案</Badge>
                <Badge variant="secondary">
                  {chips.totalEpisodes} 集（已出片 {chips.done}）
                </Badge>
                {usageDay && (
                  <Badge variant="secondary">30 日 AI 成本 ${usageDay.totals.actualCostUsd.toFixed(2)}</Badge>
                )}
                {balance && balance.mode !== "OFF" && (
                  <Badge variant="secondary">
                    {balance.mode === "SHADOW"
                      ? `已用 $${balance.totalSpentUsd.toFixed(2)}`
                      : `餘額 $${balance.balanceUsd.toFixed(2)}`}
                  </Badge>
                )}
              </div>
            )}

            <Card className="py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[280px]">專案名稱</TableHead>
                    <TableHead>畫風包</TableHead>
                    <TableHead className="w-[90px]">比例</TableHead>
                    <TableHead className="w-[90px]">集數</TableHead>
                    <TableHead className="w-[120px]">進度</TableHead>
                    <TableHead className="w-[110px]">狀態</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projects.map((p) => {
                    const st = projectStatus(p);
                    const latest = latestEpisode(p);
                    return (
                      <TableRow
                        key={p.id}
                        className="cursor-pointer"
                        onClick={() => router.push(`/projects/${p.id}`)}
                      >
                        <TableCell className="font-medium">
                          <Link
                            href={`/projects/${p.id}`}
                            className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {p.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{p.stylePackId}</TableCell>
                        <TableCell className="text-muted-foreground">{p.videoRatio}</TableCell>
                        <TableCell>{p.episodes.length} 集</TableCell>
                        <TableCell>
                          {latest ? <StationDots status={latest.status} /> : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={st.variant}>{st.label}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
