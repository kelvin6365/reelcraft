// Episode-plan domain: the shape stored in Project.planResult/planConfig, plus
// pure operations on the planned-episode list (merge/split/move/rename/delete)
// and a heuristic risk backstop. All ops are pure array transforms + anchor
// re-slicing — no AI call (docs/plans/2026-07-19-episode-planning-design.md).
import { z } from "zod";
import { PlannedEpisode, type EpisodeRisk } from "@/lib/prompts/schemas";

export const PlanConfig = z.object({
  anchor: z.enum(["length", "count"]),
  seconds: z.number().int().positive().optional(), // when anchor==='length'
  count: z.number().int().positive().optional(), // when anchor==='count'
  hookStrength: z.enum(["normal", "strong"]).default("strong"),
});
export type PlanConfig = z.infer<typeof PlanConfig>;

export const PlanResult = z.object({
  episodes: z.array(PlannedEpisode),
});
export type PlanResult = z.infer<typeof PlanResult>;

export function planConfigFromJson(v: unknown): PlanConfig | null {
  const p = PlanConfig.safeParse(v);
  return p.success ? p.data : null;
}

export function planResultFromJson(v: unknown): PlanResult {
  const p = PlanResult.safeParse(v);
  return p.success ? p.data : { episodes: [] };
}

// Human-readable target hint fed to the prompt.
export function targetHint(cfg: PlanConfig): string {
  return cfg.anchor === "length"
    ? `每集約 ${cfg.seconds ?? 90} 秒的成片時長`
    : `全劇共約 ${cfg.count ?? 12} 集，內容平均分配`;
}

// Re-number episodes 1..n after any structural edit.
function renumber(eps: PlannedEpisode[]): PlannedEpisode[] {
  return eps.map((e, i) => ({ ...e, index: i + 1 }));
}

export function renameEpisode(eps: PlannedEpisode[], index: number, title: string): PlannedEpisode[] {
  return eps.map((e) => (e.index === index ? { ...e, title } : e));
}

export function deleteEpisode(eps: PlannedEpisode[], index: number): PlannedEpisode[] {
  return renumber(eps.filter((e) => e.index !== index));
}

// Merge episode `index` into its predecessor: keep the earlier startAnchor and
// the later endAnchor (the span the two covered), join summaries/hooks.
export function mergeIntoPrev(eps: PlannedEpisode[], index: number): PlannedEpisode[] {
  const pos = eps.findIndex((e) => e.index === index);
  if (pos <= 0) return eps; // nothing before it
  const prev = eps[pos - 1];
  const cur = eps[pos];
  const merged: PlannedEpisode = {
    ...prev,
    endAnchor: cur.endAnchor,
    summary: [prev.summary, cur.summary].filter(Boolean).join("；"),
    hook: cur.hook || prev.hook,
    risk: { level: "review", flags: [], note: "手動合併，建議確認邊界" },
  };
  const next = [...eps.slice(0, pos - 1), merged, ...eps.slice(pos + 1)];
  return renumber(next);
}

// Split episode `index` at a caller-provided anchor pair (from the UI's picked
// boundary inside the episode's own text). The two halves inherit the parent's
// framing; risk is flagged for review since titles/hooks are provisional.
export function splitEpisode(
  eps: PlannedEpisode[],
  index: number,
  atEndAnchor: string,
  nextStartAnchor: string,
): PlannedEpisode[] {
  const pos = eps.findIndex((e) => e.index === index);
  if (pos < 0) return eps;
  const cur = eps[pos];
  const first: PlannedEpisode = {
    ...cur,
    endAnchor: atEndAnchor,
    title: `${cur.title}（上）`,
    risk: { level: "review", flags: [], note: "手動拆分，建議確認邊界與鉤子" },
  };
  const second: PlannedEpisode = {
    ...cur,
    startAnchor: nextStartAnchor,
    title: `${cur.title}（下）`,
    risk: { level: "review", flags: [], note: "手動拆分，建議確認邊界與鉤子" },
  };
  return renumber([...eps.slice(0, pos), first, second, ...eps.slice(pos + 1)]);
}

// Move the boundary between episode `index` and the next: set this one's
// endAnchor and the next one's startAnchor.
export function moveBoundary(
  eps: PlannedEpisode[],
  index: number,
  newEndAnchor: string,
  newNextStartAnchor: string,
): PlannedEpisode[] {
  const pos = eps.findIndex((e) => e.index === index);
  if (pos < 0 || pos === eps.length - 1) return eps;
  const updated = [...eps];
  updated[pos] = { ...updated[pos], endAnchor: newEndAnchor };
  updated[pos + 1] = { ...updated[pos + 1], startAnchor: newNextStartAnchor };
  return updated;
}

export interface RiskSummary {
  total: number;
  problem: number;
  review: number;
  ok: number;
}

export function summarizeRisk(eps: PlannedEpisode[]): RiskSummary {
  const level = (e: PlannedEpisode) => e.risk?.level ?? "ok";
  return {
    total: eps.length,
    problem: eps.filter((e) => level(e) === "problem").length,
    review: eps.filter((e) => level(e) === "review").length,
    ok: eps.filter((e) => level(e) === "ok").length,
  };
}

// Heuristic backstop: even if the model under-reports, flag episodes whose
// sliced length is wildly off target or that lack a hook. Never downgrades a
// model-reported problem; only raises attention.
export function applyHeuristicRisk(
  eps: PlannedEpisode[],
  slicedLengths: number[],
  cfg: PlanConfig,
): PlannedEpisode[] {
  // rough chars/second for CJK narration → seconds of screen time
  const CHARS_PER_SEC = 5;
  const targetSec = cfg.anchor === "length" ? (cfg.seconds ?? 90) : 90;
  return eps.map((e, i) => {
    const risk: EpisodeRisk = { level: e.risk?.level ?? "ok", flags: [...(e.risk?.flags ?? [])], note: e.risk?.note ?? "" };
    const sec = (slicedLengths[i] ?? 0) / CHARS_PER_SEC;
    const addFlag = (f: (typeof risk.flags)[number], raise: "review" | "problem", note: string) => {
      if (!risk.flags.includes(f)) risk.flags.push(f);
      if (raise === "problem" || risk.level === "ok") risk.level = risk.level === "problem" ? "problem" : raise;
      if (!risk.note) risk.note = note;
    };
    if (sec > targetSec * 1.6) addFlag("too_long", "review", "偏長，建議拆分");
    else if (sec < targetSec * 0.5) addFlag("too_short", "review", "偏短，建議合併");
    if (!e.hook?.trim()) addFlag("weak_hook", "review", "結尾缺懸念鉤子");
    return { ...e, risk };
  });
}
