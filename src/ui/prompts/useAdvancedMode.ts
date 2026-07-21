"use client";
// Advanced prompt mode toggle — gates every advanced-mode UI entry point
// (station <> buttons, settings prompt tab). Optimistic so the settings
// switch and the episode-page station buttons feel instant.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/ui/api";
import { qk, userPreferencesQuery } from "@/ui/query-keys";
import type { UserPreferences } from "@/ui/types";

export function useAdvancedMode(opts: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({ ...userPreferencesQuery(), enabled: opts.enabled ?? true });

  const mutation = useMutation({
    mutationFn: (advancedMode: boolean) => api.put<UserPreferences>("/api/user/preferences", { advancedMode }),
    onMutate: async (advancedMode) => {
      await queryClient.cancelQueries({ queryKey: qk.userPreferences });
      const previous = queryClient.getQueryData<UserPreferences>(qk.userPreferences);
      queryClient.setQueryData<UserPreferences>(qk.userPreferences, { advancedMode });
      return { previous };
    },
    onError: (_err, _advancedMode, context) => {
      if (context?.previous) queryClient.setQueryData(qk.userPreferences, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.userPreferences });
    },
  });

  return {
    advancedMode: query.data?.advancedMode ?? false,
    setAdvancedMode: (value: boolean) => mutation.mutate(value),
    pending: mutation.isPending,
  };
}
