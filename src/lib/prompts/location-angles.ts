// Pure helpers for PR3's per-angle location image generation — kept separate
// from the worker handler so the branch/merge logic can be tested without
// mocking Prisma/generateImage.

export interface LocationAngle {
  label: string;
  prompt: string;
  mediaId: string | null;
}

export interface AngleStyle {
  locationPrefix?: string;
  assetPrefix?: string;
  prefix?: string;
  negativePrompt?: string;
}

const ANGLE_REF_FRAMING =
  "wide establishing reference view, unified perspective with consistent vanishing points, consistent logically-motivated lighting true to the scene's time of day, logically coherent spatial layout, empty scene with no people, no characters, no text, no labels, clean composition, rich environmental detail, high quality";

const ANGLE_CONSISTENCY_NOTE =
  "same location as the reference image — identical architecture, furniture, materials and lighting logic, viewed from a different camera position";

export function buildLocationMainPrompt(basePrompt: string, style: AngleStyle): string {
  const stylePart = style.locationPrefix ?? style.assetPrefix ?? style.prefix ?? "";
  return [stylePart, basePrompt, ANGLE_REF_FRAMING].filter(Boolean).join(". ").trim();
}

export function buildAngleImagePrompt(basePrompt: string, angle: Pick<LocationAngle, "prompt">, style: AngleStyle): string {
  const stylePart = style.locationPrefix ?? style.assetPrefix ?? style.prefix ?? "";
  return [stylePart, basePrompt, angle.prompt ?? "", ANGLE_CONSISTENCY_NOTE, ANGLE_REF_FRAMING]
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
