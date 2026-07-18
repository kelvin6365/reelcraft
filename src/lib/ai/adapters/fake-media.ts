// Fake media adapter — generates REAL playable assets locally via ffmpeg so the
// whole pipeline runs offline: solid-color PNG stills, color+text video clips,
// sine-wave "TTS" audio. Dev/test only. Only generate-media.ts may import this.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

function hashColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const r = 40 + (h % 120);
  const g = 40 + ((h >>> 7) % 120);
  const b = 60 + ((h >>> 14) % 140);
  return `0x${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function dims(aspectRatio: string): [number, number] {
  return aspectRatio === "16:9" ? [1280, 720] : [720, 1280];
}

async function withTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "rc-fake-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function fakeImage(promptSeed: string, aspectRatio: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const [w, h] = dims(aspectRatio);
  return withTemp(async (dir) => {
    const out = join(dir, "img.png");
    await exec("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", `color=c=${hashColor(promptSeed)}:s=${w}x${h}`,
      "-frames:v", "1", out,
    ]);
    return { buffer: await readFile(out), mimeType: "image/png" };
  });
}

export async function fakeVideo(promptSeed: string, seconds: number, aspectRatio: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const [w, h] = dims(aspectRatio);
  return withTemp(async (dir) => {
    const out = join(dir, "clip.mp4");
    // plain color clip — no drawtext (not all local ffmpeg builds ship it)
    await exec("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", `color=c=${hashColor(promptSeed)}:s=${w}x${h}:d=${seconds}`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", "-r", "24",
      out,
    ]);
    return { buffer: await readFile(out), mimeType: "video/mp4" };
  });
}

export async function fakeTts(text: string): Promise<{ buffer: Buffer; mimeType: string; seconds: number }> {
  // duration scales with text length (~4 chars/sec), min 1s max 8s
  const seconds = Math.min(8, Math.max(1, Math.round(text.length / 4)));
  const freq = 300 + ((text.length * 37) % 300);
  return withTemp(async (dir) => {
    const out = join(dir, "tts.m4a");
    await exec("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", `sine=frequency=${freq}:duration=${seconds}`,
      "-c:a", "aac", "-b:a", "64k", out,
    ]);
    return { buffer: await readFile(out), mimeType: "audio/mp4", seconds };
  });
}
