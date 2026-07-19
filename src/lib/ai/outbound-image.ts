// Outbound reference-image normalization for character consistency
// (docs/plans/2026-07-19-character-consistency-design.md). Turns locked-asset
// mediaIds into provider-ready base64 data-URIs: fetched from storage, downscaled
// + JPEG-compressed (keeps multi-ref payloads small), deduped, capped, and
// partial-failure tolerant — a couple of unreachable refs don't sink the shot.
// Only generate-media.ts may import this (guard: no-ai-bypass).
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { AiError } from "@/lib/ai/types";

const MAX_REFS = 6; // provider payload sanity cap (huobao/waoowaoo both cap ~6)
const MAX_EDGE = 1024; // downscale longest edge
const JPEG_QUALITY = 80;

async function toDataUri(mediaId: string): Promise<string | null> {
  try {
    const media = await prisma.mediaObject.findUnique({ where: { id: mediaId } });
    if (!media) return null;
    const raw = await getStorage().getObjectBuffer(media.storageKey);
    const jpeg = await sharp(raw)
      .rotate() // honor EXIF orientation
      .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch (err) {
    console.error("[outbound-image] normalize failed", { mediaId, err: String(err) });
    return null;
  }
}

// Resolve an ordered list of reference mediaIds to data-URIs, preserving order
// (order is load-bearing — the prompt's 图片N legend maps to this array). Dedupes
// by mediaId first. Throws only if EVERY reference fails.
export async function normalizeReferenceImages(mediaIds: (string | null | undefined)[]): Promise<string[]> {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const m of mediaIds) {
    if (m && !seen.has(m)) {
      seen.add(m);
      ids.push(m);
    }
  }
  ids.splice(MAX_REFS);
  if (ids.length === 0) return [];

  const resolved = await Promise.all(ids.map(toDataUri));
  const ok = resolved.filter((u): u is string => u !== null);
  if (ok.length === 0) {
    throw new AiError("REFERENCE_ALL_FAILED", `all ${ids.length} reference image(s) failed to normalize`, true);
  }
  return ok;
}
