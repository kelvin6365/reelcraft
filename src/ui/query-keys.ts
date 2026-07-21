"use client";
// Single source of truth for TanStack Query keys + queryOptions (v5 pattern:
// co-locating key and fn keeps invalidation type-safe and greppable).
// Invalidate with e.g. queryClient.invalidateQueries({ queryKey: qk.episode(id) }).

import { queryOptions } from "@tanstack/react-query";
import { api } from "@/ui/api";
import type {
  EpisodeView,
  FailedTask,
  LastPromptResponse,
  ModelsResponse,
  ProjectFailedTask,
  ProjectPlanView,
  ProjectSummary,
  PromptDetailView,
  PromptStatusView,
  ProviderKeysResponse,
  ProviderReadinessResponse,
  UsageResponse,
  UserModelDefaultsResponse,
  UserPreferences,
} from "@/ui/types";

export const qk = {
  projects: ["projects"] as const,
  project: (id: string) => ["project", id] as const,
  episode: (id: string) => ["episode", id] as const,
  usage: (groupBy: string, days: number) => ["usage", groupBy, days] as const,
  models: (projectId?: string) => ["models", projectId ?? null] as const,
  userBalance: ["user", "balance"] as const,
  userModelDefaults: ["user", "model-defaults"] as const,
  providerKeys: ["user", "provider-keys"] as const,
  providerReadiness: (projectId?: string) => ["user", "provider-readiness", projectId ?? null] as const,
  failedTasks: (episodeId: string) => ["tasks", episodeId, "failed"] as const,
  projectFailedTasks: (projectId: string) => ["project", projectId, "failed-tasks"] as const,
  userPreferences: ["user", "preferences"] as const,
  prompts: (projectId?: string) => ["prompts", projectId ?? null] as const,
  prompt: (promptId: string, projectId?: string) => ["prompt", promptId, projectId ?? null] as const,
  lastPrompt: (episodeId: string, promptId: string) => ["episode", episodeId, "last-prompt", promptId] as const,
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

export const USAGE_DAYS_OPTIONS = [7, 30, 90] as const;
export type UsageDays = (typeof USAGE_DAYS_OPTIONS)[number];

export const usageQuery = (groupBy: "day" | "model" | "episode" | "prompt", days: UsageDays = 30) =>
  queryOptions({
    queryKey: qk.usage(groupBy, days),
    queryFn: () => api.get<UsageResponse>(`/api/usage?groupBy=${groupBy}&days=${days}`),
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

export const providerReadinessQuery = (projectId?: string) =>
  queryOptions({
    queryKey: qk.providerReadiness(projectId),
    queryFn: () =>
      api.get<ProviderReadinessResponse>(
        projectId ? `/api/user/provider-readiness?projectId=${projectId}` : "/api/user/provider-readiness",
      ),
  });

export const failedTasksQuery = (episodeId: string) =>
  queryOptions({
    queryKey: qk.failedTasks(episodeId),
    queryFn: () => api.get<FailedTask[]>(`/api/tasks?episodeId=${episodeId}&status=failed`),
  });

export const projectFailedTasksQuery = (projectId: string) =>
  queryOptions({
    queryKey: qk.projectFailedTasks(projectId),
    queryFn: () => api.get<ProjectFailedTask[]>(`/api/projects/${projectId}/failed-tasks`),
  });

export const userPreferencesQuery = () =>
  queryOptions({
    queryKey: qk.userPreferences,
    queryFn: () => api.get<UserPreferences>("/api/user/preferences"),
  });

export const promptsQuery = (projectId?: string) =>
  queryOptions({
    queryKey: qk.prompts(projectId),
    queryFn: async () => {
      const { prompts } = await api.get<{ prompts: PromptStatusView[] }>(
        projectId ? `/api/prompts?projectId=${projectId}` : "/api/prompts",
      );
      return prompts;
    },
  });

export const promptQuery = (promptId: string, projectId?: string) =>
  queryOptions({
    queryKey: qk.prompt(promptId, projectId),
    queryFn: () =>
      api.get<PromptDetailView>(
        projectId ? `/api/prompts/${promptId}?projectId=${projectId}` : `/api/prompts/${promptId}`,
      ),
  });

export const lastPromptQuery = (episodeId: string, promptId: string) =>
  queryOptions({
    queryKey: qk.lastPrompt(episodeId, promptId),
    queryFn: () => api.get<LastPromptResponse>(`/api/episodes/${episodeId}/last-prompt?promptId=${promptId}`),
  });
