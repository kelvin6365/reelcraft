"use client";
import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { api } from "@/ui/api";
import { useAction } from "@/ui/planning/useAction";
import { qk } from "@/ui/query-keys";
import type { NextAction } from "@/ui/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { scrollToStation } from "./stations";

export function NextActionCard({ nextAction, episodeId }: { nextAction: NextAction; episodeId: string }) {
  const { busy, err, run } = useAction(qk.episode(episodeId));
  const [queued, setQueued] = useState(false);
  const running = busy || nextAction.busy;

  function handleClick() {
    if (!nextAction.endpoint) {
      scrollToStation(nextAction.stage);
      return;
    }
    const endpoint = nextAction.endpoint;
    setQueued(false);
    void run(() => api.post(endpoint)).then(() => setQueued(true));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">下一步</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm font-medium">{nextAction.label}</p>
        {nextAction.endpoint ? (
          <>
            {typeof nextAction.estCostUsd === "number" && (
              <p className="text-xs text-muted-foreground">預估成本 ~US${nextAction.estCostUsd.toFixed(2)}</p>
            )}
            <Button className="w-full" onClick={handleClick} disabled={running}>
              {running ? (
                <>
                  <Loader2 className="animate-spin" /> 進行中…
                </>
              ) : (
                "一鍵執行"
              )}
            </Button>
            {queued && !running && !err && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CheckCircle2 className="size-3.5 text-green-600 dark:text-green-400" /> 已排入生成隊列，可留意上方進度條。
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">呢步需要你喺對應嘅站入面操作。</p>
            <Button variant="outline" className="w-full" onClick={() => scrollToStation(nextAction.stage)}>
              去該站
            </Button>
          </>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
