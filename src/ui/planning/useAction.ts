"use client";
// Small shared hook: run a POST/PATCH with local busy + error state, then
// (optionally) refetch. Same shape as the internal helper in episode/panels.tsx.
import { useState } from "react";
import { ApiClientError } from "@/ui/api";

export function useAction(refetch: () => Promise<void> | void) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>, opts: { refetch?: boolean } = {}) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      if (opts.refetch !== false) await refetch();
    } catch (e) {
      setErr((e as ApiClientError).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, err, run, setErr };
}
