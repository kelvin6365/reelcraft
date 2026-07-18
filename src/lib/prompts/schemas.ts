// zod schemas for pipeline prompt outputs (docs/tech/06-prompts.md).
// One schema per JSON-output prompt; shared by parse.ts and the canary layer.
// rewrite_script has no schema — it returns plain script text, not JSON.
import { z } from "zod";

const timeOfDay = z.enum(["早", "日", "黃昏", "夜"]);

// episode_split
export const EpisodeSplitOutput = z.object({
  episodes: z
    .array(
      z.object({
        index: z.number().int().positive(),
        title: z.string(),
        startAnchor: z.string().min(1),
        endAnchor: z.string().min(1),
        summary: z.string(),
        hook: z.string().optional().default(""),
      }),
    )
    .min(1),
});
export type EpisodeSplitOutput = z.infer<typeof EpisodeSplitOutput>;

// extract_assets
export const ExtractAssetsOutput = z.object({
  characters: z.array(
    z.object({
      name: z.string().min(1),
      aliases: z.array(z.string()).default([]),
      level: z.enum(["lead", "supporting", "extra"]),
      appearance: z.string(),
      wardrobe: z.string().optional().default(""),
      note: z.string().optional().default(""),
    }),
  ),
  locations: z.array(
    z.object({
      name: z.string().min(1),
      timeOfDay,
      description: z.string(),
      note: z.string().optional().default(""),
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
export const StoryboardPlanOutput = z.object({
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

// storyboard_detail
export const DetailOutput = z.object({
  shots: z.array(
    z.object({
      index: z.number().int().positive(),
      shotSize: z.string(),
      angle: z.string(),
      camera: z.string(),
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
      emotion: z.string(),
      emotionStrength: z.number().min(0.1).max(0.5),
      matchedShotIndex: z.number().int(),
    }),
  ),
});
export type VoiceAnalyzeOutput = z.infer<typeof VoiceAnalyzeOutput>;

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
  image_prompt_shot: ImagePromptShotOutput,
} as const;

export type OutputSchemaId = keyof typeof outputSchemas;
