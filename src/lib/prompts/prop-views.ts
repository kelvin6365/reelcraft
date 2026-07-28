// Pure helpers for Prop's per-view image generation. Deliberately NOT sharing
// location-angles.ts's ANGLE_REF_FRAMING — that framing is a wide "empty scene"
// establishing shot for environments, wrong for a prop's isolated white-background
// product shot. mergeAngleMediaId (pure data merge) is reused directly from there.

export interface PropView {
  label: string;
  prompt: string;
  mediaId: string | null;
}

export interface PropViewStyle {
  assetPrefix?: string;
  prefix?: string;
  negativePrompt?: string;
}

// Pure white background — no "neutral" fallback (product-photo standard, same
// bar as Character's "Clean pure white background, flat even studio lighting").
export const PROP_REF_FRAMING =
  "clean product-reference sheet of a single isolated object, pure white background (#FFFFFF), no people, no hands, no shadow gradients other than a soft contact shadow directly beneath the object, flat even studio lighting, accurate scale and material detail, high quality";

// 之前寫法（"same object as the reference image — identical material, color,
// proportions and markings, viewed from a different angle"）太軟性、太後置——擺
// 喺一堆描述性文字中間，好易被前面嘅 basePrompt／view.prompt 蓋過。實測發現生成
// 出嚟嘅「反面」可以係完全唔同物料/顏色/造型嘅另一件武器。改用強制口吻、擺喺最
// 當眼位置（basePrompt 之前）+ 結尾再重申一次（sandwich），逼模型將參考圖視為
// 唯一事實來源，唔可以按文字描述重新詮釋件物件。
const PROP_IDENTITY_LOCK_OPEN =
  "CRITICAL: this MUST be the exact same physical object as the one in the reference image — do not redesign, reinterpret, or invent a different object. Copy its exact color palette, material, silhouette, ornamentation and proportions precisely";
const PROP_IDENTITY_LOCK_CLOSE =
  "the object's identity, materials and colors must remain pixel-faithful to the reference image at all times — only the camera angle/framing changes, nothing about the object itself";

// tier=effect (glowing/light-based props) risks washing out against pure white —
// user confirmed white-bg consistency still wins, so we counter with an explicit
// visibility instruction instead of special-casing the background itself.
const EFFECT_VISIBILITY_NOTE =
  "the light/energy effect must remain vividly visible and saturated against the white background — do not let it wash out or fade";

export type PropTier = "key" | "scene" | "effect";

// 固定角度指示，唔靠 AI／用戶一定要填 view.prompt 先至知係邊個角度——AI 之前成日
// 填類似「可能刻有符文或紋飾」呢類含糊句子，加埋落 prompt 反而幫倒忙。而家 view.prompt
// 淨係當「額外補充」，得用戶／AI 有實質具體細節先值得填，冇填都唔會冇咗「呢個係邊個角
// 度」呢個核心指示（真係有需要先打，唔打就淨係用返固定角度指令 + 參考圖）。
const VIEW_ANGLE_HINTS: Record<string, string> = {
  正面: "front-facing view, straight-on",
  反面: "back view, showing the reverse side",
  側面: "side profile view, 90 degrees",
  細節特寫: "extreme close-up on the finest surface/material detail",
};

export function buildPropMainPrompt(basePrompt: string, material: string, dimensions: string, tier: PropTier, style: PropViewStyle): string {
  const stylePart = style.assetPrefix ?? style.prefix ?? "";
  const metadata = [material, dimensions].filter(Boolean).join(", ");
  return [stylePart, basePrompt, metadata, PROP_REF_FRAMING, tier === "effect" ? EFFECT_VISIBILITY_NOTE : ""]
    .filter(Boolean)
    .join(". ")
    .trim();
}

export function buildPropViewPrompt(basePrompt: string, view: Pick<PropView, "label" | "prompt">, tier: PropTier, style: PropViewStyle): string {
  const stylePart = style.assetPrefix ?? style.prefix ?? "";
  const angleInstruction = [VIEW_ANGLE_HINTS[view.label], view.prompt || ""].filter(Boolean).join(", ");
  return [
    stylePart,
    PROP_IDENTITY_LOCK_OPEN,
    basePrompt,
    angleInstruction,
    PROP_REF_FRAMING,
    tier === "effect" ? EFFECT_VISIBILITY_NOTE : "",
    PROP_IDENTITY_LOCK_CLOSE,
  ]
    .filter(Boolean)
    .join(". ")
    .trim();
}

export function buildPropNegativePrompt(style: PropViewStyle): string {
  return [
    style.negativePrompt,
    "colored background, gradient background, scene background, environment, room, outdoor, people, person, human figure, hands",
    "different object, redesigned object, reinterpreted design, inconsistent object, different materials, different colors, different weapon, different item",
  ]
    .filter(Boolean)
    .join(", ");
}
