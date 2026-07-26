// zod schemas for pipeline prompt outputs (docs/tech/06-prompts.md).
// One schema per JSON-output prompt; shared by parse.ts and the canary layer.
// rewrite_script has no schema — it returns plain script text, not JSON.
import { z } from "zod";

const timeOfDay = z.enum(["早", "日", "黃昏", "夜"]);

// episode_split — per-episode risk self-evaluation powers review-by-exception.
export const RISK_FLAGS = [
  "weak_hook",
  "too_long",
  "too_short",
  "low_density",
  "mid_scene_cut",
  "dialogue_overflow",
] as const;

export const EpisodeRisk = z.object({
  level: z.enum(["ok", "review", "problem"]).default("ok"),
  flags: z.array(z.enum(RISK_FLAGS)).default([]),
  note: z.string().optional().default(""),
});
export type EpisodeRisk = z.infer<typeof EpisodeRisk>;

export const PlannedEpisode = z.object({
  index: z.number().int().positive(),
  title: z.string(),
  startAnchor: z.string().min(1),
  endAnchor: z.string().min(1),
  summary: z.string(),
  hook: z.string().optional().default(""),
  risk: EpisodeRisk.optional().default({ level: "ok", flags: [], note: "" }),
});
export type PlannedEpisode = z.infer<typeof PlannedEpisode>;

export const EpisodeSplitOutput = z.object({
  episodes: z.array(PlannedEpisode).min(1),
});
export type EpisodeSplitOutput = z.infer<typeof EpisodeSplitOutput>;

// extract_assets
// Models sometimes emit null instead of omitting an optional free-text field
// (observed on locations.note after the v3 prompt change) — treat null as "".
const optionalText = z
  .string()
  .nullish()
  .transform((v) => v ?? "");
export const ExtractAssetsOutput = z.object({
  characters: z.array(
    z.object({
      name: z.string().min(1),
      aliases: z.array(z.string()).default([]),
      level: z.enum(["lead", "supporting", "extra"]),
      appearance: z.string(),
      wardrobe: optionalText,
      note: optionalText,
      // 人物小傳 (S2) — 反哺 rewrite_script，令對白貼人設
      age: optionalText,
      occupation: optionalText,
      personality: optionalText,
      painPoint: optionalText, // 內心缺失
      backstory: optionalText, // 前史 2-3 句
    }),
  ),
  locations: z.array(
    z.object({
      name: z.string().min(1),
      timeOfDay,
      description: z.string(),
      note: optionalText,
      // AI 建議視角 (S2) — 重要場景（出現 ≥2 場戲或關鍵劇情發生地）至少 2 個，普通場景為空陣列
      angles: z
        .array(z.object({ label: z.string().min(1), prompt: z.string().min(1) }))
        .nullish()
        .transform((v) => v ?? []),
    }),
  ),
});
export type ExtractAssetsOutput = z.infer<typeof ExtractAssetsOutput>;

// build_scenes — anchors only, code locates them in the original text.
export const ScenesOutput = z.object({
  scenes: z
    .array(
      z.object({
        index: z.number().int().positive(),
        startAnchor: z.string().min(1),
        endAnchor: z.string().min(1),
        summary: z.string(),
        elementCount: z.number().int().nonnegative().optional(),
        location: z.string().optional().default(""),
        timeOfDay: timeOfDay.optional(),
      }),
    )
    .min(1),
});
export type ScenesOutput = z.infer<typeof ScenesOutput>;

// storyboard_plan
// 場景空間契約 — 一場一份，鎖死角色左右位/面向/道具，全場鏡頭共守（180° 軸）。
export const SceneBlocking = z.object({
  cameraAxis: z.string().default(""), // 攝影機喺軸線邊一側，e.g. 「鏡頭一律喺窗一側」
  positions: z
    .array(
      z.object({
        name: z.string(),
        screenSide: z.enum(["left", "right", "center"]).default("center"),
        facing: z.string().default(""), // e.g. 面向畫面右
        placement: z.string().default(""), // e.g. 坐窗邊桌左側
      }),
    )
    .default([]),
  keyProps: z.array(z.string()).default([]),
});
export type SceneBlocking = z.infer<typeof SceneBlocking>;

export const StoryboardPlanOutput = z.object({
  blocking: SceneBlocking.optional().default({ cameraAxis: "", positions: [], keyProps: [] }),
  shots: z
    .array(
      z.object({
        index: z.number().int().positive(),
        source_text: z.string().min(1),
        subject: z.string(),
        beat: z.string().optional().default(""),
        characters: z.array(z.string()).default([]),
        dialogue: z.string().optional().default(""),
      }),
    )
    .min(1),
});
export type StoryboardPlanOutput = z.infer<typeof StoryboardPlanOutput>;

// storyboard_photography
export const PhotographyOutput = z.object({
  shots: z.array(
    z.object({
      index: z.number().int().positive(),
      lighting: z.string(),
      dof: z.enum(["shallow", "medium", "deep"]),
      focusFace: z.string().optional().default(""),
      tone: z.string(),
      note: z.string().optional().default(""),
    }),
  ),
});
export type PhotographyOutput = z.infer<typeof PhotographyOutput>;

// storyboard_acting
export const ActingOutput = z.object({
  shots: z.array(
    z.object({
      index: z.number().int().positive(),
      expression: z.string(),
      bodyAction: z.string(),
      eyeline: z.string().optional().default(""),
      note: z.string().optional().default(""),
    }),
  ),
});
export type ActingOutput = z.infer<typeof ActingOutput>;

// storyboard_detail — also emits a motion-ready i2v video_prompt per shot.
export const DetailOutput = z.object({
  shots: z.array(
    z.object({
      index: z.number().int().positive(),
      shotSize: z.string(),
      angle: z.string(),
      camera: z.string(),
      video_prompt: z.string().optional().default(""),
      note: z.string().optional().default(""),
    }),
  ),
});
export type DetailOutput = z.infer<typeof DetailOutput>;

// voice_analyze — emotionStrength hard-capped at 0.5 (waoowaoo idea, CLAUDE.md #7).
export const VoiceAnalyzeOutput = z.object({
  lines: z.array(
    z.object({
      index: z.number().int().positive(),
      text: z.string().min(1),
      speaker: z.string(),
      lineType: z.enum(["dialogue", "vo", "os"]).default("dialogue"),
      cue: z.string().default(""), // 括號演技/語氣提示（VO/OS 保留字除外）
      emotion: z.string(),
      emotionStrength: z.number().min(0.1).max(0.5),
      matchedShotIndex: z.number().int(),
    }),
  ),
});
export type VoiceAnalyzeOutput = z.infer<typeof VoiceAnalyzeOutput>;

// script_review — 劇本體檢 (S3): per-scene checklist risk, same review-by-exception
// shape as episode planning but with script-specific flags. Informational only.
export const SCRIPT_RISK_FLAGS = [
  "no_purpose", // 呢場戲冇明確戲劇目的
  "unnatural_dialogue", // 對白唔似人話
  "pacing_drag", // 節奏拖
  "weak_hook", // 結尾鉤子唔夠
  "telling_not_showing", // 講出嚟代替演出嚟
] as const;

export const ScriptRisk = z.object({
  level: z.enum(["ok", "review", "problem"]).default("ok"),
  flags: z.array(z.enum(SCRIPT_RISK_FLAGS)).default([]),
  note: z.string().optional().default(""),
});
export type ScriptRisk = z.infer<typeof ScriptRisk>;

export const ScriptReviewOutput = z.object({
  scenes: z.array(
    z.object({
      index: z.number().int().positive(),
      label: z.string().default(""), // e.g. 第1場・咖啡店
      risk: ScriptRisk,
    }),
  ),
  overall: ScriptRisk.extend({ note: z.string().min(1) }), // 總評必須有一句話
});
export type ScriptReviewOutput = z.infer<typeof ScriptReviewOutput>;

// image_prompt_shot
export const ImagePromptShotOutput = z.object({
  prompt: z.string().min(1),
  negativePrompt: z.string().optional().default(""),
  referencedAssets: z.array(z.string()).default([]),
});
export type ImagePromptShotOutput = z.infer<typeof ImagePromptShotOutput>;

// Registry — promptId → schema, for generic parse-and-validate flows.
export const outputSchemas = {
  episode_split: EpisodeSplitOutput,
  extract_assets: ExtractAssetsOutput,
  build_scenes: ScenesOutput,
  storyboard_plan: StoryboardPlanOutput,
  storyboard_photography: PhotographyOutput,
  storyboard_acting: ActingOutput,
  storyboard_detail: DetailOutput,
  voice_analyze: VoiceAnalyzeOutput,
  script_review: ScriptReviewOutput,
  image_prompt_shot: ImagePromptShotOutput,
} as const;

export type OutputSchemaId = keyof typeof outputSchemas;
