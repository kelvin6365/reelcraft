"use client";
// Small balance indicator in the top bar. Hidden entirely when billing is OFF
// (the endpoint reports `mode`), so it costs nothing visually in dev/free tiers.
import { useQuery } from "@tanstack/react-query";
import { balanceQuery } from "@/ui/query-keys";

export function BalanceChip() {
  // balance is non-critical chrome — stay silent on failure, just render null.
  const { data } = useQuery(balanceQuery());

  if (!data || data.mode === "OFF") return null;

  const held = data.frozenUsd > 0 ? `（凍結 $${data.frozenUsd.toFixed(2)}）` : "";
  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground tabular-nums"
      title={`已用 $${data.totalSpentUsd.toFixed(2)}`}
    >
      餘額 ${data.balanceUsd.toFixed(2)}
      {held}
    </span>
  );
}
