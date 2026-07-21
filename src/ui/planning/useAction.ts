"use client";
// Shared mutation-runner over TanStack useMutation. Callers pass the query keys
// to invalidate on success instead of a refetch callback — no more prop-drilling.
// `run(fn, { refetch: false })` skips invalidation (e.g. silent prompt saves).
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiClientError } from "@/ui/api";

export function useAction(...invalidateKeys: readonly (readonly unknown[])[]) {
  const queryClient = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (input: { fn: () => Promise<unknown>; refetch: boolean }) => input.fn(),
    onSuccess: async (_data, input) => {
      if (input.refetch) {
        await Promise.all(invalidateKeys.map((key) => queryClient.invalidateQueries({ queryKey: [...key] })));
      }
    },
    onError: (e) => setErr(e instanceof ApiClientError ? e.message : (e as Error).message),
  });
  async function run(fn: () => Promise<unknown>, opts: { refetch?: boolean } = {}) {
    setErr(null);
    try {
      await mutation.mutateAsync({ fn, refetch: opts.refetch !== false });
    } catch {
      /* error surfaced via err state */
    }
  }
  return { busy: mutation.isPending, err, run, setErr };
}
