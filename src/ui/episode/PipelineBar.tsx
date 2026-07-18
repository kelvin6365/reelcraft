"use client";
import type { StageKey, StageState } from "@/ui/types";
import { STATIONS, scrollToStation } from "./stations";

export function PipelineBar({
  stages,
  progress,
}: {
  stages: StageState[];
  progress: Partial<Record<StageKey, number>>;
}) {
  const byKey = Object.fromEntries(stages.map((s) => [s.key, s])) as Record<StageKey, StageState | undefined>;
  return (
    <div className="pipeline">
      {STATIONS.map((st) => {
        const s = byKey[st.key];
        const pct = progress[st.key];
        const active = typeof pct === "number";
        return (
          <button
            key={st.key}
            className={`station-pill${s?.done ? " done" : ""}${active ? " active" : ""}`}
            onClick={() => scrollToStation(st.key)}
            title={st.name}
          >
            <div className="st-idx">第 {st.index} 站</div>
            <div className="st-name">
              {st.name}
              {s?.done && <span className="check">✓</span>}
            </div>
            {active ? (
              <div className="st-count" style={{ color: "var(--warn)" }}>
                生成中 {pct}%
              </div>
            ) : (
              // hide "0/0" noise on stations whose work hasn't been created yet
              s?.count &&
              s.count.total > 0 && (
                <div className="st-count">
                  {s.count.done}/{s.count.total}
                </div>
              )
            )}
          </button>
        );
      })}
    </div>
  );
}
