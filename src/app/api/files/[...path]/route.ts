// PUBLIC: local dev file serving, keys are unguessable UUIDs
// Serves objects written by the local storage provider. In s3 mode this route
// is unused (signed URLs point straight at the bucket). 404 on missing or any
// path that escapes the storage root.
import { LocalStorageProvider } from "@/lib/storage/local";

const local = new LocalStorageProvider();

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  json: "application/json",
  txt: "text/plain",
};

function mimeForKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? "application/octet-stream";
}

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const key = path.join("/");

  let buffer: Buffer;
  try {
    buffer = await local.getObjectBuffer(key);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": mimeForKey(key),
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
