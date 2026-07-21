"use client";
import { Loader2 } from "lucide-react";
import { api } from "@/ui/api";
import { useAction } from "@/ui/planning/useAction";
import { qk } from "@/ui/query-keys";
import type { NextAction } from "@/ui/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { scrollToStation } from "./stations";

export function NextActionCard({ nextAction, episodeId }: { nextAction: NextAction; episodeId: string }) {
  const { busy, err, run } = useAction(qk.episode(episodeId));
  const running = busy || nextAction.busy;

  function handleClick() {
    if (!nextAction.endpoint) {
      scrollToStation(nextAction.stage);
      return;
    }
    const endpoint = nextAction.endpoint;
    void run(() => api.post(endpoint));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">下一步</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm font-medium">{nextAction.label}</p>
        {nextAction.endpoint ? (
          <Button className="w-full" onClick={handleClick} disabled={running}>
            {running ? (
              <>
                <Loader2 className="animate-spin" /> 進行中…
              </>
            ) : (
              "一鍵執行"
            )}
          </Button>
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
