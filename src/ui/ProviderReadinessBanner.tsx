"use client";
// Onboarding guardrail: warns a (often non-technical) user, BEFORE they hit
// PROVIDER_KEY_MISSING mid-generation, that a required provider has no usable
// key (see docs/tech/03-provider-layer.md — 3-layer key resolution). Renders
// nothing once every apiType slot in the current resolved model defaults is
// ready. Dismissable for the session, but reappears next session while still
// not ready (sessionStorage, not localStorage — CLAUDE.md doesn't require
// persistence across browser sessions and a stale "dismissed forever" flag
// would defeat the whole point of this banner).
import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, X } from "lucide-react";
import { providerReadinessQuery } from "@/ui/query-keys";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

function dismissKey(projectId?: string): string {
  return `provider-readiness-dismissed:${projectId ?? "global"}`;
}

export function ProviderReadinessBanner({ projectId }: { projectId?: string }) {
  const { data } = useQuery(providerReadinessQuery(projectId));
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(sessionStorage.getItem(dismissKey(projectId)) === "1");
  }, [projectId]);

  if (!data || data.allReady || dismissed) return null;

  const missing = data.items.filter((i) => !i.ready);
  const first = missing[0];
  const label = `${first.providerLabel} ${first.apiTypeLabel}`;
  const extra = missing.length - 1;

  function dismiss() {
    sessionStorage.setItem(dismissKey(projectId), "1");
    setDismissed(true);
  }

  return (
    <Alert variant="destructive" className="items-center">
      <AlertTriangle />
      <AlertTitle>仲差一步先可以生成</AlertTitle>
      <AlertDescription>
        <p>
          未連接「{label}」金鑰{extra > 0 ? `（仲有 ${extra} 個未連接）` : ""}。去設定接駁，或聯絡管理員開通平台共用金鑰。
        </p>
      </AlertDescription>
      <div className="col-start-2 mt-1 flex items-center gap-2">
        <Button asChild size="sm">
          <Link href="/settings">去設定</Link>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="關閉提示"
          onClick={dismiss}
        >
          <X /> 關閉
        </Button>
      </div>
    </Alert>
  );
}
