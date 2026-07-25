"use client";
// 專案總覽 — rebuilt to the Pencil ref (frame nfIj9): metric cards, projects
// table with status badges, sidebar shell. Data layer is TanStack Query.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { ApiClientError } from "@/ui/api";
import { useSession } from "@/ui/auth-client";
import { balanceQuery, projectsQuery, usageQuery } from "@/ui/query-keys";
import type { ProjectSummary } from "@/ui/types";
import { ProviderReadinessBanner } from "@/ui/ProviderReadinessBanner";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function projectStatus(p: ProjectSummary): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  if (p.episodes.length === 0) return { label: "草稿", variant: "outline" };
  if (p.episodes.some((e) => e.status.includes("FAILED"))) return { label: "有失敗", variant: "destructive" };
  if (p.episodes.every((e) => e.status === "COMPOSED")) return { label: "已完成", variant: "secondary" };
  return { label: "進行中", variant: "default" };
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

  const metrics = useMemo(() => {
    const totalEpisodes = projects?.reduce((n, p) => n + p.episodes.length, 0) ?? 0;
    const composed =
      projects?.reduce((n, p) => n + p.episodes.filter((e) => e.status === "COMPOSED").length, 0) ?? 0;
    return [
      { label: "專案", value: projects ? String(projects.length) : null, hint: "全部專案" },
      { label: "劇集", value: projects ? `${totalEpisodes} 集` : null, hint: `已出片 ${composed} 集` },
      {
        label: "AI 成本（30 日）",
        value: usageDay ? `$${usageDay.totals.actualCostUsd.toFixed(2)}` : null,
        hint: usageDay ? `${usageDay.totals.calls} 次呼叫` : "",
      },
      {
        label: "餘額",
        value: balance && balance.mode !== "OFF" ? `$${balance.balanceUsd.toFixed(2)}` : "—",
        hint: balance && balance.frozenUsd > 0 ? `凍結 $${balance.frozenUsd.toFixed(2)}` : "",
      },
    ];
  }, [projects, usageDay, balance]);

  if (isPending || !session) {
    return <div className="flex min-h-svh items-center justify-center text-muted-foreground">載入中…</div>;
  }

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

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">專案總覽</h1>
          <p className="mt-1 text-sm text-muted-foreground">貼一段小說，行八站流程出一集短劇。</p>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {metrics.map((m) => (
            <Card key={m.label}>
              <CardContent className="space-y-1 p-6">
                <p className="text-sm text-muted-foreground">{m.label}</p>
                {m.value === null ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <p className="text-2xl font-semibold tabular-nums">{m.value}</p>
                )}
                {m.hint ? <p className="text-xs text-muted-foreground">{m.hint}</p> : null}
              </CardContent>
            </Card>
          ))}
        </div>

        {loadErr && <p className="text-sm text-destructive">{loadErr}</p>}

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">我的專案</h2>
          </div>

          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : projects && projects.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
                <p className="text-base">仲未有專案。</p>
                <p className="text-sm text-muted-foreground">建立第一個專案，貼一段小說，行八站流程出一集短劇。</p>
                <Button asChild>
                  <Link href="/projects/new">
                    <Plus /> 建立專案
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : projects ? (
            <Card className="py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[280px]">專案名稱</TableHead>
                    <TableHead>畫風包</TableHead>
                    <TableHead className="w-[90px]">比例</TableHead>
                    <TableHead className="w-[90px]">集數</TableHead>
                    <TableHead className="w-[110px]">狀態</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projects.map((p) => {
                    const st = projectStatus(p);
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
                          <Badge variant={st.variant}>{st.label}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
