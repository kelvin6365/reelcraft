// Pure display-name helper for the station chips (ImagesPanel/VideosPanel
// header). Turns a full `provider::modelId` key into a short, readable label
// — e.g. "fal::fal-ai/kling-video/v3/standard/image-to-video" -> "kling-v3".
// `fake::*` is flagged distinctly so users immediately see they're on the fake
// provider (the original silent-fake-video incident this whole design fixes).
export function shortModelName(modelKey: string): string {
  const idx = modelKey.indexOf("::");
  const provider = idx > 0 ? modelKey.slice(0, idx) : modelKey;
  const modelId = idx > 0 ? modelKey.slice(idx + 2) : modelKey;
  if (provider === "fake") return "fake（測試）";

  const segments = modelId.split("/").filter(Boolean);
  if (segments.length === 0) return modelId;
  // Drop a leading vendor/org segment (fal-ai, google, …) when there's enough
  // left over to still be meaningful.
  const rest = segments.length > 1 ? segments.slice(1) : segments;

  const family = rest[0].replace(/-(video|image|model|speech)$/i, "");
  const version = rest[1];
  if (version && /^v\d/i.test(version)) return `${family}-${version}`;
  return family;
}

export function isFakeModel(modelKey: string): boolean {
  return modelKey.startsWith("fake::");
}
