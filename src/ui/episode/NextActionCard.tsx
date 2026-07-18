"use client";
import { useState } from "react";
import { api, ApiClientError } from "@/ui/api";
import type { NextAction } from "@/ui/types";
import { scrollToStation } from "./stations";

export function NextActionCard({ nextAction, refetch }: { nextAction: NextAction; refetch: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const running = busy || nextAction.busy;

  async function run() {
    if (!nextAction.endpoint) {
      scrollToStation(nextAction.stage);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.post(nextAction.endpoint);
      await refetch();
    } catch (e) {
      setErr((e as ApiClientError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="nba">
      <div className="nba-label">下一步</div>
      <div className="nba-action">{nextAction.label}</div>
      {nextAction.endpoint ? (
        <button className="btn btn-primary" style={{ width: "100%" }} onClick={run} disabled={running}>
          {running ? (
            <>
              <span className="spinner" /> 進行中…
            </>
          ) : (
            "一鍵執行"
          )}
        </button>
      ) : (
        <>
          <p className="nba-hint">呢步需要你喺對應嘅站入面操作。</p>
          <button className="btn" style={{ width: "100%" }} onClick={() => scrollToStation(nextAction.stage)}>
            去該站
          </button>
        </>
      )}
      {err && (
        <p className="error-text" style={{ marginTop: 10 }}>
          {err}
        </p>
      )}
    </div>
  );
}
