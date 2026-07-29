// Pure helpers for PR3's per-angle location image generation — kept separate
// from the worker handler so the branch/merge logic can be tested without
// mocking Prisma/generateImage.

export interface LocationAngle {
  label: string;
  prompt: string;
  mediaId: string | null;
  // 呢個角度點解值得生成——AI 判斷依據（例：「出現於3場戲」「衝突爆發嘅高潮場口」），
  // 淨係 location angles 有；character/prop views 用返呢個 type 但無呢個概念，留空。
  reason?: string;
}

export interface AngleStyle {
  locationPrefix?: string;
  assetPrefix?: string;
  prefix?: string;
  negativePrompt?: string;
}

const ANGLE_REF_FRAMING =
  "wide establishing reference view, unified perspective with consistent vanishing points, consistent logically-motivated lighting true to the scene's time of day, logically coherent spatial layout, empty scene with no people, no characters, no text, no labels, clean composition, rich environmental detail, high quality";

// label（例如「巢穴入口望向光照区域」）先係真正話畀生圖模型知「攝影機擺去邊、望
// 向邊」嘅指示——之前呢個 function 淨係揀咗 angle.prompt（而家設計上通常留空），
// 完全冇帶 label 落去，搞到個 prompt 冇任何線索指示鏡頭要轉向邊，變成同主圖一樣
// 嘅角度。所以呢句要將 label 明確寫入「camera repositioned to」。
function buildAngleConsistencyNote(label: string): string {
  return [
    "same location as the reference image — identical architecture, furniture, materials and lighting logic",
    label ? `camera repositioned to this new viewpoint: ${label}` : "viewed from a different camera position",
  ].join(", ");
}

// 圖生圖専用框景指示——同 ANGLE_REF_FRAMING 唔同，冇「clean composition / rich
// environmental detail / high quality」呢類質素形容詞：已鎖定主圖已經體現晒個畫
// 風質素，唔使再講一次；淨係保留視角一致性同「冇人物」呢兩樣圖生圖必須嘅硬指示。
const ANGLE_DELTA_FRAMING =
  "wide establishing reference view, unified perspective with consistent vanishing points, consistent logically-motivated lighting true to the scene's time of day, logically coherent spatial layout, empty scene with no people, no characters, no text, no labels";

export function buildLocationMainPrompt(basePrompt: string, style: AngleStyle): string {
  const stylePart = style.locationPrefix ?? style.assetPrefix ?? style.prefix ?? "";
  return [stylePart, basePrompt, ANGLE_REF_FRAMING].filter(Boolean).join(". ").trim();
}

// 圖生圖以已鎖定主圖做參考——basePrompt(環境描述) 保留，因為佢帶住例如光線/天氣
// 呢類隨劇情轉變嘅資訊，主圖未必反映到；但 style 前綴（全局畫風、質素形容詞）由
// 參考圖本身已經體現，唔使再講一次。angle.prompt 係呢個角度先有嘅實物細節 delta，
// 通常留空。
export function buildAngleImagePrompt(basePrompt: string, angle: Pick<LocationAngle, "label" | "prompt">): string {
  return [basePrompt, angle.prompt ?? "", buildAngleConsistencyNote(angle.label), ANGLE_DELTA_FRAMING]
    .filter(Boolean)
    .join(". ")
    .trim();
}

export function buildAngleNegativePrompt(style: AngleStyle): string {
  return [style.negativePrompt, "people, person, human figure, crowd, silhouette of a person"].filter(Boolean).join(", ");
}

// Writes mediaId into angles[index] without disturbing any other angle's
// label/prompt/mediaId — safe to call against a freshly re-read row so a
// concurrent edit to another angle (or this one's label/prompt) isn't clobbered.
export function mergeAngleMediaId(angles: LocationAngle[], index: number, mediaId: string): LocationAngle[] {
  if (index < 0 || index >= angles.length) {
    throw new RangeError(`angle index ${index} out of range (length ${angles.length})`);
  }
  return angles.map((a, i) => (i === index ? { ...a, mediaId } : a));
}
