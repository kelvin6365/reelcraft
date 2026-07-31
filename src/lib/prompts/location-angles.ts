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

export function buildLocationMainPrompt(basePrompt: string, style: AngleStyle): string {
  const stylePart = style.locationPrefix ?? style.assetPrefix ?? style.prefix ?? "";
  return [stylePart, basePrompt, ANGLE_REF_FRAMING].filter(Boolean).join(". ").trim();
}

// 圖生圖已經用緊已鎖定主圖做參考——generateImage() 見到 referenceMediaIds 就自動
// 轉用 provider 嘅 /edit 端點（見 generate-media.ts effectiveImageModelKey），
// 呢個已經係編輯模型，唔係由零生圖，所以唔使成段環境描述／畫風／框景形容詞再打
// 一次：畫風、光線、佈局主圖本身已經全部體現。淨係需要一句短短嘅編輯指令話畀
// 模型知邊度要變——label（例如「巢穴入口望向光照区域」）就係嗰句真正嘅轉鏡指示。
export function buildAngleImagePrompt(angle: Pick<LocationAngle, "label" | "prompt">): string {
  return [
    `Edit this reference image: reposition the camera to ${angle.label || "a different viewpoint"} within the same location`,
    angle.prompt ?? "",
    "keep the same architecture, furniture, materials and lighting logic",
    "no people, no characters, no text, no labels",
  ]
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
