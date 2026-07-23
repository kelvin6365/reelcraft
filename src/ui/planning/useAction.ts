"use client";
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
  // Returns whether the action succeeded. Errors are still swallowed into `err`
  // (callers render it), but a caller that shows a success affordance — 「已儲存」,
  // 「已排入生成隊列」 — must be able to tell, or it ends up claiming success
  // right next to an error message.
  async function run(fn: () => Promise<unknown>, opts: { refetch?: boolean } = {}): Promise<boolean> {
    setErr(null);
    try {
      await mutation.mutateAsync({ fn, refetch: opts.refetch !== false });
      return true;
    } catch {
      return false;
    }
  }
  return { busy: mutation.isPending, err, run, setErr };
}
