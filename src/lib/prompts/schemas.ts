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

// extract_characters / extract_locations
// Models sometimes emit null instead of omitting an optional free-text field
// (observed on locations.note after the v3 prompt change) — treat null as "".
const optionalText = z
  .string()
  .nullish()
  .transform((v) => v ?? "");
// Split out of the former single extract_assets call: one top-level key per
// prompt. flash-lite drops an entire top-level key often enough that the
// corrective loop in textCallJson needs 3 attempts (shared.ts) — with one key
// per schema a dropped key is an outright parse failure that retries, instead
// of a half-empty result that validates clean and silently loses one asset type.
export const ExtractCharactersOutput = z.object({
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
});
export type ExtractCharactersOutput = z.infer<typeof ExtractCharactersOutput>;

export const ExtractLocationsOutput = z.object({
  locations: z.array(
    z.object({
      name: z.string().min(1),
      timeOfDay,
      description: z.string(),
      note: optionalText,
      // AI 建議視角 (S2) — 重要場景（出現 ≥2 場戲或關鍵劇情發生地）至少 2 個，普通場景為空陣列
      // prompt 允許空字串——圖生圖以已鎖定主圖做參考，冇具體細節就留空，唔可以自己作
      // 猜測性描述；reason 記低判斷依據（點解值得建呢個角度），純文字唔係畫面描述。
      angles: z
        .array(z.object({ label: z.string().min(1), prompt: optionalText, reason: optionalText }))
        .nullish()
        .transform((v) => v ?? []),
    }),
  ),
});
export type ExtractLocationsOutput = z.infer<typeof ExtractLocationsOutput>;

// extract_props — independent from the extract_characters/extract_locations
// pass (retry isolation: a props
// parse failure must not force-retry the already-stable characters/locations
// pass). target_name lets the caller ask for one specific prop (手動補抽);
// the conditional instruction lives in the prompt template itself, not here.
export const ExtractPropsOutput = z.object({
  props: z.array(
    z.object({
      name: z.string().min(1),
      tier: z.enum(["key", "scene", "effect"]).default("key"),
      description: z.string(),
      material: optionalText,
      dimensions: optionalText,
      note: optionalText,
      sceneName: optionalText,
      physicalParams: optionalText,
      // prompt 允許空字串——extract_props.zh.txt 明確要求「冇具體細節就留空,唔可以
      // 自己作猜測性描述」,固定角度指示由 prop-views.ts 嘅 VIEW_ANGLE_HINTS 憑
      // label 提供,view.prompt 淨係做額外補充,唔強制要求有內容。
      views: z
        .array(z.object({ label: z.string().min(1), prompt: optionalText }))
        .nullish()
        .transform((v) => v ?? []),
    }),
  ).nullish().transform((v) => v ?? []),
});
export type ExtractPropsOutput = z.infer<typeof ExtractPropsOutput>;

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
        // 閃回／回憶／夢境鏡頭。**呢個欄位唔係權威**：最終標記由 markFlashbackShots
        // 用原文括號註記確定性判定，模型呢個自報只係 OR 入去補漏（冇括號註記、純靠
        // 「兩年前」敘述嗰種閃回程式一定認唔到）。optional + default(false)：舊資料同
        // 冇輸出呢個欄位嘅模型照樣 parse 得過，唔可以為咗個新欄位令成場 storyboard fail。
        flashback: z.boolean().optional().default(false),
        // 閃回本身嘅地點文字（「電腦前」）。程式抽唔到嘅自由文本，所以呢個位真係要靠模型；
        // 飄咗都唔會靜默壞（最壞情況＝冇環境描述，同認唔出地點一樣）。
        flashback_location: z.string().optional().default(""),
      }),
    )
    .min(1),
});
export type StoryboardPlanOutput = z.infer<typeof StoryboardPlanOutput>;

// storyboard_photography
// .min(1) matches StoryboardPlanOutput/ScenesOutput: a per-shot pass that came
// back with zero shots is a failed generation, not an empty-but-valid result.
// Without it a truncated-then-repaired `{"shots":[]}` validated cleanly and the
// handler wrote photography: null onto every shot with no error anywhere.
export const PhotographyOutput = z.object({
  shots: z
    .array(
      z.object({
        index: z.number().int().positive(),
        lighting: z.string(),
        dof: z.enum(["shallow", "medium", "deep"]),
        focusFace: z.string().optional().default(""),
        tone: z.string(),
        note: z.string().optional().default(""),
      }),
    )
    .min(1),
});
export type PhotographyOutput = z.infer<typeof PhotographyOutput>;

// storyboard_acting
export const ActingOutput = z.object({
  shots: z
    .array(
      z.object({
        index: z.number().int().positive(),
        expression: z.string(),
        bodyAction: z.string(),
        eyeline: z.string().optional().default(""),
        note: z.string().optional().default(""),
      }),
    )
    .min(1), // 見 PhotographyOutput：零鏡 = 生成失敗，唔係合法空結果
});
export type ActingOutput = z.infer<typeof ActingOutput>;

// storyboard_detail — also emits a motion-ready i2v video_prompt per shot.
export const DetailOutput = z.object({
  shots: z
    .array(
      z.object({
        index: z.number().int().positive(),
        shotSize: z.string(),
        angle: z.string(),
        camera: z.string(),
        video_prompt: z.string().optional().default(""),
        note: z.string().optional().default(""),
      }),
    )
    .min(1), // 見 PhotographyOutput：零鏡 = 生成失敗，唔係合法空結果
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

// image_prompt_shot —— 截斷偵測用「條款在唔在」，唔用字數。
//
// 呢度本來係 .min(600)：當時觀察到完整英文 prompt 790–1531 字元、被截斷嘅 128–491，
// 就攞 600 做地板。但字數只係代理指標，而佢綁死咗語言 —— prompt 輸出語言改成跟原文
// （見 output-language.ts）之後，中文密度高約 1.75 倍（實測平均 731 vs 英文 1281），
// 32/47 條完全正常嘅中文 prompt 即刻被打回頭，成個 scene 白燒三次重試。
//
// 真正要捉嘅嘢由頭到尾都唔係「短」，而係「尾巴俾人斬走咗」——模板強制 prompt 結尾
// 一字不改照抄連續性條款（禁拼貼、參考圖只作身份參照、禁畫文字），而截斷第一個
// 食掉嘅就係佢。shot 26 出五行英文字幕，就係因為呢段冇送到。
//
// 所以直接驗條款在唔在：精確（唔使估門檻）、語言無關（兩版各認一個獨有片段）、
// 而且捉到「模型自己漏寫條款」呢種字數檢查本來就捉唔到嘅情況。
const CONTINUITY_CLAUSE_MARKERS = [
  "Never render any text", // 英文版尾句
  "絕不出現任何文字", // 繁中版尾句
];

export const ImagePromptShotOutput = z.object({
  prompt: z
    .string()
    .min(1)
    .refine((p) => CONTINUITY_CLAUSE_MARKERS.some((m) => p.includes(m)), {
      message: "prompt 缺少連續性條款（被截斷或模型漏寫）——呢段一失，出圖就會拼貼／畫字／抄參考圖構圖",
    }),
  negativePrompt: z.string().optional().default(""),
  referencedAssets: z.array(z.string()).default([]),
});
export type ImagePromptShotOutput = z.infer<typeof ImagePromptShotOutput>;

// Registry — promptId → schema, for generic parse-and-validate flows.
export const outputSchemas = {
  episode_split: EpisodeSplitOutput,
  extract_characters: ExtractCharactersOutput,
  extract_locations: ExtractLocationsOutput,
  extract_props: ExtractPropsOutput,
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
