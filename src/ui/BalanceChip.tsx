"use client";
// Small balance indicator in the top bar. Hidden entirely when billing is OFF
// (the endpoint reports `mode`), so it costs nothing visually in dev/free tiers.
import { useEffect, useState } from "react";
import { api } from "@/ui/api";

interface BalanceResponse {
  mode: "OFF" | "SHADOW" | "ENFORCE";
  balanceUsd: number;
  frozenUsd: number;
  totalSpentUsd: number;
}

export function BalanceChip() {
  const [data, setData] = useState<BalanceResponse | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<BalanceResponse>("/api/user/balance")
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        /* balance is non-critical chrome — stay silent on failure */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!data || data.mode === "OFF") return null;

  const held = data.frozenUsd > 0 ? `（凍結 $${data.frozenUsd.toFixed(2)}）` : "";
  return (
    <span className="topbar-link" title={`已用 $${data.totalSpentUsd.toFixed(2)}`}>
      餘額 ${data.balanceUsd.toFixed(2)}
      {held}
    </span>
  );
}
