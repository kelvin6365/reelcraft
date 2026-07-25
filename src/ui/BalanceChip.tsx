"use client";
// Small balance indicator in the top bar. Hidden entirely when billing is OFF
// (the endpoint reports `mode`), so it costs nothing visually in dev/free tiers.
import { useQuery } from "@tanstack/react-query";
import { balanceQuery } from "@/ui/query-keys";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function BalanceChip() {
  // balance is non-critical chrome — stay silent on failure, just render null.
  const { data, isLoading } = useQuery(balanceQuery());

  if (isLoading) return <Skeleton className="h-5 w-24 rounded-full" />;
  if (!data || data.mode === "OFF") return null;

  // SHADOW 未強制扣費，餘額冇意義 — 淨係顯示已用金額；ENFORCE 先顯示餘額。
  if (data.mode === "SHADOW") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground tabular-nums"
          >
            已用 ${data.totalSpentUsd.toFixed(2)}
          </span>
        </TooltipTrigger>
        <TooltipContent>已用 ${data.totalSpentUsd.toFixed(2)}</TooltipContent>
      </Tooltip>
    );
  }

  const held = data.frozenUsd > 0 ? `（凍結 $${data.frozenUsd.toFixed(2)}）` : "";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground tabular-nums"
        >
          餘額 ${data.balanceUsd.toFixed(2)}
          {held}
        </span>
      </TooltipTrigger>
      <TooltipContent>已用 ${data.totalSpentUsd.toFixed(2)}</TooltipContent>
    </Tooltip>
  );
}
