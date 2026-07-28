// Pure helpers for Character's single-front-view main image + per-view (側面/背面)
// generation. Mirrors prop-views.ts's structure; reuses LocationAngle for the
// view shape (label/prompt/mediaId) instead of redeclaring a CharacterView type —
// props keep their own PropView because tier drives extra framing logic that
// characters don't need.
import type { LocationAngle } from "@/lib/prompts/location-angles";

export interface CharacterViewStyle {
  assetPrefix?: string;
  prefix?: string;
  negativePrompt?: string;
}

// 舊版「多視角設定表」換成單一正面全身圖——側面/背面留返鎖定之後先按需要逐張生成
// （同 Prop.views 一致嘅模式），唔再一次過逼模型喺一張圖入面砌三個角度。
export const CHARACTER_FRONT_FRAMING =
  "full-body standing front view of the character, facing the camera, both hands fully visible and relaxed naturally at the sides, entire body visible head to toe, clean pure white background, flat even studio lighting, sharp focus, no cast shadows, no text, no labels, clean composition, rich detail, high quality";

// 抄 prop-views.ts 嘅 identity-sandwich 做法：強制口吻擺喺 basePrompt 之前 + 結尾
// 再重申一次，逼模型將參考圖視為身份嘅唯一事實來源，唔可以按角度描述重新詮釋個角色。
const CHARACTER_IDENTITY_LOCK_OPEN =
  "CRITICAL: this MUST be the exact same character as in the reference image — identical face, hairstyle, outfit, body proportions and colors; do not redesign or reinterpret the character";
const CHARACTER_IDENTITY_LOCK_CLOSE =
  "the character's face, hairstyle, outfit and proportions must remain pixel-faithful to the reference image — only the camera angle changes, nothing about the character";

const VIEW_ANGLE_HINTS: Record<string, string> = {
  側面: "full-body side profile view, 90 degrees, entire body visible",
  背面: "full-body back view, seen from directly behind, entire body visible",
};

export const DEFAULT_CHARACTER_VIEWS: LocationAngle[] = [
  { label: "側面", prompt: "", mediaId: null },
  { label: "背面", prompt: "", mediaId: null },
];

export const REF_FACE_MATCH_PROMPT = "The character's face MUST exactly match the face in the reference image.";

export function buildCharacterFacePrompt(basePrompt: string, style: CharacterViewStyle): string {
  const stylePart = style.assetPrefix ?? style.prefix ?? "";
  return [
    stylePart,
    basePrompt,
    "close-up head-and-shoulders portrait of the SAME character as the reference image — identical face, hairstyle and features. Front-facing, neutral calm expression, eyes looking at camera, clean pure white background, flat even studio lighting, sharp focus, no text, no labels, rich facial detail, high quality, 4K resolution",
  ]
    .filter(Boolean)
    .join(". ")
    .trim();
}

export function buildCharacterMainPrompt(basePrompt: string, style: CharacterViewStyle, extra: string[] = []): string {
  const stylePart = style.assetPrefix ?? style.prefix ?? "";
  return [stylePart, basePrompt, CHARACTER_FRONT_FRAMING, ...extra].filter(Boolean).join(". ").trim();
}

export function buildCharacterViewPrompt(basePrompt: string, view: Pick<LocationAngle, "label" | "prompt">, style: CharacterViewStyle): string {
  const stylePart = style.assetPrefix ?? style.prefix ?? "";
  return [
    stylePart,
    CHARACTER_IDENTITY_LOCK_OPEN,
    basePrompt,
    VIEW_ANGLE_HINTS[view.label] ?? view.label,
    view.prompt || "",
    "clean pure white background, flat even studio lighting, no text, no labels, high quality",
    CHARACTER_IDENTITY_LOCK_CLOSE,
  ]
    .filter(Boolean)
    .join(". ")
    .trim();
}

export function buildCharacterNegativePrompt(style: CharacterViewStyle): string {
  return [style.negativePrompt, "different character, redesigned character, reinterpreted design, inconsistent character, different face, different outfit"]
    .filter(Boolean)
    .join(", ");
}
