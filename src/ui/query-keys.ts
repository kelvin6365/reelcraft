"use client";
// Single source of truth for TanStack Query keys + queryOptions (v5 pattern:
// co-locating key and fn keeps invalidation type-safe and greppable).
// Invalidate with e.g. queryClient.invalidateQueries({ queryKey: qk.episode(id) }).

import { queryOptions } from "@tanstack/react-query";
import { api } from "@/ui/api";
import type {
  EpisodeView,
  FailedTask,
  ModelsResponse,
  ProjectPlanView,
  ProjectSummary,
  ProviderKeysResponse,
  UsageResponse,
  UserModelDefaultsResponse,
} from "@/ui/types";

export const qk = {
  projects: ["projects"] as const,
  project: (id: string) => ["project", id] as const,
  episode: (id: string) => ["episode", id] as const,
  usage: (groupBy: string) => ["usage", groupBy] as const,
  models: (projectId?: string) => ["models", projectId ?? null] as const,
  userBalance: ["user", "balance"] as const,
  userModelDefaults: ["user", "model-defaults"] as const,
  providerKeys: ["user", "provider-keys"] as const,
  failedTasks: (episodeId: string) => ["tasks", episodeId, "failed"] as const,
};

export const projectsQuery = () =>
  queryOptions({
    queryKey: qk.projects,
    queryFn: () => api.get<ProjectSummary[]>("/api/projects"),
  });

export const projectQuery = (id: string) =>
  queryOptions({
    queryKey: qk.project(id),
    queryFn: () => api.get<ProjectPlanView>(`/api/projects/${id}`),
  });

export const episodeQuery = (id: string) =>
  queryOptions({
    queryKey: qk.episode(id),
    queryFn: () => api.get<EpisodeView>(`/api/episodes/${id}`),
  });

export const usageQuery = (groupBy: "day" | "model" | "episode" | "prompt") =>
  queryOptions({
    queryKey: qk.usage(groupBy),
    queryFn: () => api.get<UsageResponse>(`/api/usage?groupBy=${groupBy}`),
  });

export const modelsQuery = (projectId?: string) =>
  queryOptions({
    queryKey: qk.models(projectId),
    queryFn: () => api.get<ModelsResponse>(projectId ? `/api/models?projectId=${projectId}` : "/api/models"),
  });

export interface BalanceResponse {
  mode: "OFF" | "SHADOW" | "ENFORCE";
  balanceUsd: number;
  frozenUsd: number;
  totalSpentUsd: number;
}

export const balanceQuery = () =>
  queryOptions({
    queryKey: qk.userBalance,
    queryFn: () => api.get<BalanceResponse>("/api/user/balance"),
  });

export const userModelDefaultsQuery = () =>
  queryOptions({
    queryKey: qk.userModelDefaults,
    queryFn: () => api.get<UserModelDefaultsResponse>("/api/user/model-defaults"),
  });

export const providerKeysQuery = () =>
  queryOptions({
    queryKey: qk.providerKeys,
    queryFn: () => api.get<ProviderKeysResponse>("/api/user/provider-keys"),
  });

export const failedTasksQuery = (episodeId: string) =>
  queryOptions({
    queryKey: qk.failedTasks(episodeId),
    queryFn: () => api.get<FailedTask[]>(`/api/tasks?episodeId=${episodeId}&status=failed`),
  });
