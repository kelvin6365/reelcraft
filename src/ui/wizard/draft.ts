// Pure draft model for the /projects/new wizard — no React so it's trivially
// unit-testable and reusable from both the page and its tests.

export interface WizardDraft {
  step: 1 | 2 | 3;
  text: string;
  inputType: "novel" | "srt";
  stylePackId: string;
  videoRatio: "9:16" | "16:9";
  mode: "single" | "plan";
  planConfig: {
    anchor: "length" | "count";
    seconds: number;
    count: number;
    hookStrength: "normal" | "strong";
  };
  name: string;
}

export const DRAFT_KEY = "reelcraft:new-project-draft";

export function defaultDraft(): WizardDraft {
  return {
    step: 1,
    text: "",
    inputType: "novel",
    stylePackId: "cinematic-01",
    videoRatio: "9:16",
    mode: "single",
    planConfig: { anchor: "length", seconds: 90, count: 12, hookStrength: "strong" },
    name: "",
  };
}

export function defaultName(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return "未命名專案";
  return collapsed.slice(0, 12);
}

export function parseDraft(raw: string | null): WizardDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const d = parsed as Record<string, unknown>;

  if (d.step !== 1 && d.step !== 2 && d.step !== 3) return null;
  if (typeof d.text !== "string") return null;
  if (d.inputType !== "novel" && d.inputType !== "srt") return null;
  if (typeof d.stylePackId !== "string" || !d.stylePackId) return null;
  if (d.videoRatio !== "9:16" && d.videoRatio !== "16:9") return null;
  if (d.mode !== "single" && d.mode !== "plan") return null;
  if (typeof d.name !== "string") return null;

  const pc = d.planConfig;
  if (!pc || typeof pc !== "object") return null;
  const planConfig = pc as Record<string, unknown>;
  if (planConfig.anchor !== "length" && planConfig.anchor !== "count") return null;
  if (typeof planConfig.seconds !== "number") return null;
  if (typeof planConfig.count !== "number") return null;
  if (planConfig.hookStrength !== "normal" && planConfig.hookStrength !== "strong") return null;

  return {
    step: d.step,
    text: d.text,
    inputType: d.inputType,
    stylePackId: d.stylePackId,
    videoRatio: d.videoRatio,
    mode: d.mode,
    planConfig: {
      anchor: planConfig.anchor,
      seconds: planConfig.seconds,
      count: planConfig.count,
      hookStrength: planConfig.hookStrength,
    },
    name: d.name,
  };
}
