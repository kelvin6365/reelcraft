// MediaObject service: the single path that turns bytes/URLs into rows and
// resolves signed URLs at read time. DB stores storage keys only; URLs are
// computed on read and NEVER persisted (CLAUDE.md #4). Every row carries
// userId (CLAUDE.md #1).
import { createHash } from "node:crypto";
import type { MediaObject } from "@prisma/client";
import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";
import { getStorage } from "@/lib/storage";

const DEFAULT_URL_TTL_SEC = 3600;

// Minimal, explicit mime → extension map. Unknown types fall back to "bin".
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "application/json": "json",
  "text/plain": "txt",
};

export function extForMime(mimeType: string): string {
  return MIME_EXT[mimeType.split(";")[0].trim().toLowerCase()] ?? "bin";
}

export interface CreateMediaFromBufferInput {
  userId: string;
  buffer: Buffer;
  mimeType: string;
  keyPrefix: string; // e.g. "shots/images", "characters"
}

export async function createMediaFromBuffer(input: CreateMediaFromBufferInput): Promise<MediaObject> {
  const { userId, buffer, mimeType, keyPrefix } = input;
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const publicId = newId();
  const ext = extForMime(mimeType);
  const storageKey = `${keyPrefix}/${publicId}.${ext}`;

  await getStorage().putObject(storageKey, buffer, mimeType);

  return prisma.mediaObject.create({
    data: {
      id: newId(),
      userId,
      publicId,
      storageKey,
      sha256,
      mimeType,
      sizeBytes: BigInt(buffer.byteLength),
    },
  });
}

export interface CreateMediaFromUrlInput {
  userId: string;
  url: string;
  keyPrefix: string;
}

export async function createMediaFromUrl(input: CreateMediaFromUrlInput): Promise<MediaObject> {
  const res = await fetch(input.url);
  if (!res.ok) {
    throw new Error(`fetch media failed: ${res.status} ${input.url}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get("content-type")?.split(";")[0].trim() || "application/octet-stream";
  return createMediaFromBuffer({ userId: input.userId, buffer, mimeType, keyPrefix: input.keyPrefix });
}

// Resolve a signed read URL for a mediaId, or null when there is nothing to
// resolve (unset FK) or the row is gone.
export async function getMediaUrl(
  mediaId: string | null | undefined,
  expiresSec = DEFAULT_URL_TTL_SEC,
): Promise<string | null> {
  if (!mediaId) return null;
  const media = await prisma.mediaObject.findUnique({ where: { id: mediaId } });
  if (!media) return null;
  return getStorage().getSignedUrl(media.storageKey, expiresSec);
}

// Hydrate rows with signed URLs computed at read time. For each `*MediaId`
// field named in `fields`, adds a sibling `*Url` field (MediaId → Url).
// Never mutates or persists — returns shallow copies.
export async function attachMediaUrls<T extends Record<string, unknown>>(
  rows: T[],
  fields: (keyof T & string)[],
  expiresSec = DEFAULT_URL_TTL_SEC,
): Promise<(T & Record<string, string | null>)[]> {
  // Collect every referenced mediaId once, resolve storageKeys in one query.
  const ids = new Set<string>();
  for (const row of rows) {
    for (const field of fields) {
      const v = row[field];
      if (typeof v === "string" && v) ids.add(v);
    }
  }

  const keyById = new Map<string, string>();
  if (ids.size > 0) {
    const media = await prisma.mediaObject.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, storageKey: true },
    });
    for (const m of media) keyById.set(m.id, m.storageKey);
  }

  const storage = getStorage();
  return Promise.all(
    rows.map(async (row) => {
      const out: Record<string, unknown> = { ...row };
      for (const field of fields) {
        const urlField = field.replace(/MediaId$/, "Url");
        const v = row[field];
        const storageKey = typeof v === "string" ? keyById.get(v) : undefined;
        out[urlField] = storageKey ? await storage.getSignedUrl(storageKey, expiresSec) : null;
      }
      return out as T & Record<string, string | null>;
    }),
  );
}
