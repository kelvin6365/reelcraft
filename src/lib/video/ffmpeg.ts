// FFmpeg helpers for episode composition (docs/tech/02 COMPOSE_EPISODE).
// Runs the system ffmpeg binary; worker image installs it (docs/tech/07).
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { TaskError } from "@/lib/task/types";

const exec = promisify(execFile);
const FFMPEG_TIMEOUT_MS = 10 * 60_000;

// Some ffmpeg builds (e.g. Homebrew without libfreetype) lack drawtext.
// Detect once; subtitle burning degrades gracefully when unavailable.
let drawtextAvailable: boolean | null = null;
export async function hasDrawtext(): Promise<boolean> {
  if (drawtextAvailable !== null) return drawtextAvailable;
  try {
    const { stdout } = await exec("ffmpeg", ["-hide_banner", "-filters"]);
    drawtextAvailable = stdout.includes(" drawtext ");
  } catch {
    drawtextAvailable = false;
  }
  return drawtextAvailable;
}

async function runFfmpeg(args: string[]): Promise<void> {
  try {
    await exec("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], {
      timeout: FFMPEG_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TaskError("FFMPEG_FAILED", msg.slice(0, 800), false);
  }
}

export interface ComposeShotInput {
  videoPath: string; // local file path of the shot video
  audioPath?: string; // optional TTS audio to overlay
  subtitle?: string; // optional burned-in subtitle text
}

// Mux one shot: video + optional audio + optional drawtext subtitle → mp4 (h264/aac).
export async function composeShot(input: ComposeShotInput, outPath: string): Promise<void> {
  const args: string[] = ["-i", input.videoPath];
  if (input.audioPath) args.push("-i", input.audioPath);

  const filters: string[] = [];
  if (input.subtitle && (await hasDrawtext())) {
    const safe = input.subtitle.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");
    filters.push(
      `drawtext=text='${safe}':fontcolor=white:fontsize=h/18:borderw=2:bordercolor=black@0.8:x=(w-text_w)/2:y=h-text_h-h/12`,
    );
  }
  if (filters.length) args.push("-vf", filters.join(","));

  if (input.audioPath) {
    args.push("-map", "0:v:0", "-map", "1:a:0", "-shortest");
  }
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", "20", "-c:a", "aac", "-pix_fmt", "yuv420p", outPath);
  await runFfmpeg(args);
}

// Concat composed shots into one episode file (re-encode for uniform params).
export async function concatShots(shotPaths: string[], outPath: string): Promise<void> {
  if (shotPaths.length === 0) throw new TaskError("COMPOSE_EMPTY", "no shots to concat", false);
  const dir = await mkdtemp(join(tmpdir(), "rc-concat-"));
  try {
    const listPath = join(dir, "list.txt");
    await writeFile(listPath, shotPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
    await runFfmpeg([
      "-f", "concat", "-safe", "0", "-i", listPath,
      "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-c:a", "aac", "-pix_fmt", "yuv420p",
      outPath,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Still image → N-second video clip (Ken Burns-free static hold; used when a
// shot has an image but video generation is skipped/unavailable).
export async function imageToVideoClip(imagePath: string, seconds: number, outPath: string, ratio: string): Promise<void> {
  const [w, h] = ratio === "16:9" ? [1280, 720] : [720, 1280];
  await runFfmpeg([
    "-loop", "1", "-i", imagePath, "-t", String(seconds),
    "-vf", `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`,
    "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "24",
    outPath,
  ]);
}

export async function probeDurationMs(path: string): Promise<number> {
  try {
    const { stdout } = await exec("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path,
    ]);
    return Math.round(parseFloat(stdout.trim()) * 1000) || 0;
  } catch {
    return 0;
  }
}
