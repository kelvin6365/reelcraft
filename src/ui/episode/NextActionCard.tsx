"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { api } from "@/ui/api";
import { useAction } from "@/ui/planning/useAction";
import { qk } from "@/ui/query-keys";
import type { NextAction } from "@/ui/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useStationNav } from "./station-nav";
import { formatUsd, needsCostConfirm } from "./cost-confirm";

export function NextActionCard({
  nextAction,
  episodeId,
  pendingUnits,
  suppressButton,
}: {
  nextAction: NextAction;
  episodeId: string;
  pendingUnits?: number;
  suppressButton?: boolean;
}) {
  const goToStation = useStationNav();
  const { busy, err, run } = useAction(qk.episode(episodeId));
  const [queued, setQueued] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const running = busy || nextAction.busy;

  useEffect(() => {
    setQueued(false);
  }, [nextAction.stage, nextAction.label]);

  const estCostUsd = nextAction.estCostUsd;
  const confirmFirst = needsCostConfirm({ usd: estCostUsd, units: pendingUnits });

  function fire() {
    if (!nextAction.endpoint) return;
    const endpoint = nextAction.endpoint;
    setQueued(false);
    // Take the user to the station the action runs on, so they watch it happen
    // instead of staying on whatever station they were viewing.
    goToStation(nextAction.stage);
    // Only claim it queued if it actually did — otherwise the success line
    // rendered right under the error message.
    void run(() => api.post(endpoint)).then((okd) => setQueued(okd));
  }

  function handleClick() {
    if (!nextAction.endpoint) {
      goToStation(nextAction.stage);
      return;
    }
    if (confirmFirst) {
      setConfirmOpen(true);
      return;
    }
    fire();
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
            {typeof estCostUsd === "number" && (
              <p className="text-xs text-muted-foreground">預估成本 {formatUsd(estCostUsd)}</p>
            )}
            {suppressButton ? (
              <p className="text-xs text-muted-foreground">↓ 直接喺下面嘅站操作</p>
            ) : (
              <>
                <Button className="w-full" onClick={handleClick} disabled={running}>
                  {running ? (
                    <>
                      <Loader2 className="animate-spin" /> 進行中…
                    </>
                  ) : (
                    "一鍵執行"
                  )}
                </Button>
                <ConfirmDialog
                  open={confirmOpen}
                  onOpenChange={setConfirmOpen}
                  title="開始生成？"
                  description={
                    <>
                      {nextAction.label}
                      {typeof estCostUsd === "number" ? (
                        <>
                          ，預估花費 <b>{formatUsd(estCostUsd)}</b>
                        </>
                      ) : pendingUnits ? (
                        <>，共 {pendingUnits} 項</>
                      ) : null}
                      。生成後已花費嘅成本唔會退返。
                    </>
                  }
                  confirmLabel="確定生成"
                  onConfirm={fire}
                />
                {queued && !running && !err && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CheckCircle2 className="size-3.5 text-green-600 dark:text-green-400" /> 已排入生成隊列，可留意上方進度條。
                  </p>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">呢步需要你喺對應嘅站入面操作。</p>
            <Button variant="outline" className="w-full" onClick={() => goToStation(nextAction.stage)}>
              去該站
            </Button>
          </>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
