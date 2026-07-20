"use client";
// Pre-plan setup panel: paste the full novel (saved on blur), pick ONE target
// anchor (每集約 N 秒 / 總共 N 集) + hook strength, then trigger EPISODE_SPLIT.
// While planStatus==='planning' the parent polls; we just show a spinner here.
import { useState } from "react";
import { api } from "@/ui/api";
import { useAction } from "./useAction";
import type { PlanConfigView, PlanStatus } from "@/ui/types";

const LONG_NOVEL_CHARS = 30000;

export function PlanSetup({
  id,
  initialSourceText,
  initialTheme = "",
  initialConfig,
  planStatus,
  refetch,
}: {
  id: string;
  initialSourceText: string;
  initialTheme?: string;
  initialConfig: PlanConfigView | null;
  planStatus: PlanStatus;
  refetch: () => Promise<void>;
}) {
  const [sourceText, setSourceText] = useState(initialSourceText);
  const [savedText, setSavedText] = useState(initialSourceText);
  const [theme, setTheme] = useState(initialTheme);
  const [savedTheme, setSavedTheme] = useState(initialTheme);
  const [anchor, setAnchor] = useState<"length" | "count">(initialConfig?.anchor ?? "length");
  const [seconds, setSeconds] = useState(initialConfig?.seconds ?? 90);
  const [count, setCount] = useState(initialConfig?.count ?? 12);
  const [hookStrength, setHookStrength] = useState<"normal" | "strong">(
    initialConfig?.hookStrength ?? "strong",
  );
  const { busy, err, run } = useAction(refetch);

  const planning = planStatus === "planning";
  const isLong = sourceText.length > LONG_NOVEL_CHARS;

  async function saveSourceOnBlur() {
    const text = sourceText.trim();
    if (text === savedText) return;
    await run(async () => {
      await api.patch(`/api/projects/${id}`, { sourceText: text });
      setSavedText(text);
    }, { refetch: false });
  }

  async function saveThemeOnBlur() {
    const t = theme.trim();
    if (t === savedTheme) return;
    await run(async () => {
      await api.patch(`/api/projects/${id}`, { theme: t });
      setSavedTheme(t);
    }, { refetch: false });
  }

  async function startPlan() {
    if (!sourceText.trim()) return;
    // ensure the latest novel + theme are persisted before planning
    if (sourceText.trim() !== savedText) {
      await api.patch(`/api/projects/${id}`, { sourceText: sourceText.trim() });
      setSavedText(sourceText.trim());
    }
    if (theme.trim() !== savedTheme) {
      await api.patch(`/api/projects/${id}`, { theme: theme.trim() });
      setSavedTheme(theme.trim());
    }
    const body =
      anchor === "length"
        ? { anchor, seconds, hookStrength }
        : { anchor, count, hookStrength };
    await run(() => api.post(`/api/projects/${id}/plan`, body));
  }

  return (
    <div className="card plan-panel">
      <h2 style={{ fontSize: 18, marginBottom: 4 }}>劇集規劃</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
        貼上成本小說原文，設一個目標，AI 幫你切集並自評風險，你只需審核亮燈嗰幾集。
      </p>

      <textarea
        value={sourceText}
        onChange={(e) => setSourceText(e.target.value)}
        onBlur={saveSourceOnBlur}
        rows={10}
        placeholder="喺呢度貼上成本小說原文…"
        disabled={planning}
      />
      <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
        <span className="faint" style={{ fontSize: 12 }}>{sourceText.length.toLocaleString()} 字</span>
        {savedText && sourceText.trim() === savedText && (
          <span className="faint" style={{ fontSize: 12 }}>已儲存 ✓</span>
        )}
      </div>
      {isLong && (
        <p className="plan-note">
          原文較長（超過 {LONG_NOVEL_CHARS.toLocaleString()} 字）。v1 單次規劃上限約 25 集，長篇建議分批貼章節規劃。
        </p>
      )}

      <input
        type="text"
        value={theme}
        onChange={(e) => setTheme(e.target.value)}
        onBlur={saveThemeOnBlur}
        placeholder="中心思想一句話（可留空）— 例：愛要及時說出口。切集同劇本都會錨定唔偏題"
        disabled={planning}
        style={{ marginTop: 10, width: "100%" }}
      />

      <div className="plan-target">
        <div className="plan-target-row">
          <label className="plan-radio">
            <input
              type="radio"
              name="anchor"
              checked={anchor === "length"}
              onChange={() => setAnchor("length")}
              disabled={planning}
            />
            <span>每集約</span>
            <input
              type="number"
              className="plan-num"
              value={seconds}
              min={15}
              onChange={(e) => setSeconds(Math.max(1, Number(e.target.value) || 0))}
              disabled={planning || anchor !== "length"}
            />
            <span>秒</span>
          </label>
        </div>
        <div className="plan-target-row">
          <label className="plan-radio">
            <input
              type="radio"
              name="anchor"
              checked={anchor === "count"}
              onChange={() => setAnchor("count")}
              disabled={planning}
            />
            <span>總共</span>
            <input
              type="number"
              className="plan-num"
              value={count}
              min={1}
              onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 0))}
              disabled={planning || anchor !== "count"}
            />
            <span>集</span>
          </label>
        </div>

        <div className="plan-target-row" style={{ gap: 8 }}>
          <span className="muted" style={{ fontSize: 13 }}>鉤子強度</span>
          <button
            type="button"
            className={`chip-toggle ${hookStrength === "normal" ? "on" : ""}`}
            onClick={() => setHookStrength("normal")}
            disabled={planning}
          >
            一般
          </button>
          <button
            type="button"
            className={`chip-toggle ${hookStrength === "strong" ? "on" : ""}`}
            onClick={() => setHookStrength("strong")}
            disabled={planning}
          >
            強鉤子
          </button>
        </div>
      </div>

      {err && <p className="error-text" style={{ marginTop: 10 }}>{err}</p>}

      <div className="row-end">
        <button
          className="btn btn-primary"
          onClick={startPlan}
          disabled={busy || planning || !sourceText.trim()}
        >
          {planning ? (
            <><span className="spinner" /> 規劃中…</>
          ) : busy ? (
            <span className="spinner" />
          ) : (
            "AI 規劃分集"
          )}
        </button>
      </div>
    </div>
  );
}
