// Declarative media template — plug in any image/video/tts provider with a JSON
// file instead of code (docs/tech/03-provider-layer.md §M2). Modelled on the
// idea (not code) of waoowaoo's compat media templates.
import { z } from "zod";

const HttpCall = z.object({
  method: z.enum(["GET", "POST"]),
  url: z.string().url().or(z.string().regex(/\{\{/)), // may contain {{placeholders}}
  body: z.record(z.string(), z.unknown()).optional(),
});

export const MediaTemplate = z.object({
  id: z.string().min(1),
  apiType: z.enum(["image", "video", "tts"]),
  // which provider's API key to send (resolved via getProviderKey — never a raw env name)
  apiKeyRef: z.enum(["openrouter", "fal", "atlascloud", "fake"]),
  auth: z
    .object({
      header: z.string().default("Authorization"),
      prefix: z.string().default("Bearer "),
    })
    .default({ header: "Authorization", prefix: "Bearer " }),
  create: HttpCall,
  // JSONPath-lite extractors ($.a.b[0].c) applied to the create response
  createExtract: z.object({
    taskId: z.string().optional(), // absent → synchronous: resultUrl comes from create response
    resultUrl: z.string().optional(),
  }),
  status: HttpCall.optional(),
  statusExtract: z
    .object({
      state: z.string(),
      resultUrl: z.string(),
      error: z.string().optional(),
    })
    .optional(),
  states: z
    .object({
      done: z.array(z.string()).min(1),
      failed: z.array(z.string()).default([]),
    })
    .optional(),
  polling: z
    .object({
      intervalMs: z.number().int().min(500).default(3000),
      timeoutMs: z.number().int().min(1000).default(600_000),
    })
    .default({ intervalMs: 3000, timeoutMs: 600_000 }),
});

export type MediaTemplate = z.infer<typeof MediaTemplate>;

// Allowed {{placeholders}} — anything else in a template is a validation error.
export const TEMPLATE_VARS = [
  "model",
  "prompt",
  "negative_prompt",
  "image_url",
  "duration",
  "aspect_ratio",
  "text",
  "voice_id",
  // 聲音克隆嘅參考音 URL（ref 模式）—— preset 模式行 voice_id，兩者互斥
  "reference_audio_url",
  "task_id",
] as const;
export type TemplateVar = (typeof TEMPLATE_VARS)[number];
