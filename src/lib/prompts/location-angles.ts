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

// ⚠️ 呢段會 append 落每一張場景主圖，所以佢係整條場景 prompt 入面最強嘅構圖信號。
// 舊版寫「wide establishing reference view」——一句橫構圖指令，同 API 嘅 aspect_ratio
// （而家跟 project.videoRatio，多數係 9:16）直接打架：模型跟文字畫返個開闊橫向 vista，
// 再 letterbox 塞入豎框，張場景圖本身就帶住黑邊，攞去做鏡頭參考仲會傳染落分鏡出圖。
// 改成縱向取向：由前景地面向上帶到天花／天空嘅層次感，保住「establishing（交代成個空間）／
// 統一透視／可作為機位參考」呢三個原意，只係換咗個掃視方向。
const ANGLE_REF_FRAMING =
  "vertical establishing reference view, tall full-height framing that carries the eye from the foreground floor up through the mid-ground structures to the ceiling or sky, unified perspective with consistent vanishing points, consistent logically-motivated lighting true to the scene's time of day, logically coherent spatial layout, complete enough to serve as a camera-placement reference for later shots, empty scene with no people, no characters, no text, no labels, clean composition, rich environmental detail, high quality";

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
