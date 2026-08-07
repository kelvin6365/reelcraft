// FFmpeg helpers for episode composition (docs/tech/02 COMPOSE_EPISODE).
// Runs the system ffmpeg binary; worker image installs it (docs/tech/07).
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { env } from "@/lib/env";
import { TaskError } from "@/lib/task/types";

const exec = promisify(execFile);
const FFMPEG_TIMEOUT_MS = 10 * 60_000;

// Dev servers launched from GUI terminals often miss Homebrew's PATH entry,
// so a bare "ffmpeg" spawn dies with ENOENT even when the binary is installed.
const FALLBACK_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
const binCache = new Map<string, string>();

function resolveBin(name: "ffmpeg" | "ffprobe"): string {
  const cached = binCache.get(name);
  if (cached) return cached;
  const fromEnv = name === "ffmpeg" ? env.FFMPEG_PATH : env.FFPROBE_PATH;
  const resolved =
    fromEnv ||
    FALLBACK_BIN_DIRS.map((d) => join(d, name)).find((p) => existsSync(p)) ||
    name; // last resort: trust PATH
  binCache.set(name, resolved);
  return resolved;
}

export function ffmpegBin(): string {
  return resolveBin("ffmpeg");
}

// Some ffmpeg builds (e.g. Homebrew without libfreetype) lack drawtext.
// Detect once; subtitle burning degrades gracefully when unavailable.
let drawtextAvailable: boolean | null = null;
export async function hasDrawtext(): Promise<boolean> {
  if (drawtextAvailable !== null) return drawtextAvailable;
  try {
    const { stdout } = await exec(ffmpegBin(), ["-hide_banner", "-filters"]);
    drawtextAvailable = stdout.includes(" drawtext ");
  } catch {
    drawtextAvailable = false;
  }
  return drawtextAvailable;
}

async function runFfmpeg(args: string[]): Promise<void> {
  try {
    await exec(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", ...args], {
      timeout: FFMPEG_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TaskError("FFMPEG_FAILED", msg.slice(0, 800), false);
  }
}

// escape drawtext metacharacters incl. % (text-macro expansion like %{pts})
export function escapeDrawtextText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
}

const DRAWTEXT_STYLE = "fontcolor=white:fontsize=h/18:borderw=2:bordercolor=black@0.8:x=(w-text_w)/2:y=h-text_h-h/12";

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
    filters.push(`drawtext=text='${escapeDrawtextText(input.subtitle)}':${DRAWTEXT_STYLE}`);
  }
  if (filters.length) args.push("-vf", filters.join(","));

  if (input.audioPath) {
    args.push("-map", "0:v:0", "-map", "1:a:0", "-shortest");
  }
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", "20", "-c:a", "aac", "-pix_fmt", "yuv420p", outPath);
  await runFfmpeg(args);
}

// Offset-aware compose: each voice line lands at its placed startMs (adelay),
// mixed together (amix), then hard-trimmed + padded to the clip length so the
// VIDEO is always the master duration — 冇 -shortest，音長極其量喺鏡尾被截，
// 唔會反過嚟截視頻。Subtitles get per-line drawtext enable windows.
export interface TimedComposeInput {
  videoPath: string;
  clipDurationMs: number;
  // 凍幀補時後嘅目標長度（>= clipDurationMs）。缺省 = 唔補。差額用 tpad
  // clone 最後一幀填——音溢出鏡尾嗰截先有畫面可以行完。
  paddedDurationMs?: number;
  audio: { path: string; startMs: number }[];
  subtitles: { text: string; startMs: number; endMs: number }[];
}

const sec = (ms: number) => (ms / 1000).toFixed(3);

// Pure args builder — unit-tested without running ffmpeg. `drawtext` mirrors
// hasDrawtext(): callers pass false to degrade to no-subtitle output.
export function buildTimedComposeArgs(input: TimedComposeInput, outPath: string, drawtext: boolean): string[] {
  const args: string[] = ["-i", input.videoPath];
  for (const a of input.audio) args.push("-i", a.path);

  const paddedMs = Math.max(input.paddedDurationMs ?? input.clipDurationMs, input.clipDurationMs);
  const padMs = paddedMs - input.clipDurationMs;
  const paddedSec = sec(paddedMs);
  const chains: string[] = [];

  // video chain：tpad 行先（凍住最後一幀補時）、drawtext 行後（字幕可以疊喺凍幀尾上）
  const windows = drawtext
    ? input.subtitles
        .map((s) => ({ ...s, endMs: Math.min(s.endMs, paddedMs) }))
        .filter((s) => s.text && s.endMs > s.startMs)
    : [];
  const hasVout = windows.length > 0 || padMs > 0;
  if (hasVout) {
    const steps: string[] = [];
    if (padMs > 0) steps.push(`tpad=stop_mode=clone:stop_duration=${sec(padMs)}`);
    for (const s of windows) {
      steps.push(`drawtext=text='${escapeDrawtextText(s.text)}':enable='between(t,${sec(s.startMs)},${sec(s.endMs)})':${DRAWTEXT_STYLE}`);
    }
    chains.push(`[0:v]${steps.join(",")}[vout]`);
  }

  // audio chain: adelay each line to its start, mix, then trim+pad to padded length
  const hasAout = input.audio.length > 0;
  if (hasAout) {
    input.audio.forEach((a, i) => {
      chains.push(`[${i + 1}:a:0]adelay=${Math.max(0, Math.round(a.startMs))}:all=1[a${i}]`);
    });
    const mixed =
      input.audio.length > 1
        ? (chains.push(`${input.audio.map((_, i) => `[a${i}]`).join("")}amix=inputs=${input.audio.length}:normalize=0[am]`), "[am]")
        : "[a0]";
    chains.push(`${mixed}atrim=end=${paddedSec},apad=whole_dur=${paddedSec}[aout]`);
  }

  if (chains.length) args.push("-filter_complex", chains.join(";"));
  args.push("-map", hasVout ? "[vout]" : "0:v:0");
  if (hasAout) args.push("-map", "[aout]");
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", "20");
  if (hasAout) args.push("-c:a", "aac");
  args.push("-pix_fmt", "yuv420p", outPath);
  return args;
}

export async function composeShotTimed(input: TimedComposeInput, outPath: string): Promise<void> {
  await runFfmpeg(buildTimedComposeArgs(input, outPath, input.subtitles.length > 0 && (await hasDrawtext())));
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

// Concatenate audio files into one AAC track (for a shot with several dialogue lines).
export async function concatAudio(inputs: string[], outPath: string): Promise<void> {
  if (inputs.length === 0) throw new TaskError("CONCAT_EMPTY", "no audio to concat", false);
  const args: string[] = [];
  for (const p of inputs) args.push("-i", p);
  const filter = inputs.map((_, i) => `[${i}:a:0]`).join("") + `concat=n=${inputs.length}:v=0:a=1[out]`;
  await runFfmpeg([...args, "-filter_complex", filter, "-map", "[out]", "-c:a", "aac", "-b:a", "128k", outPath]);
}

export async function probeDurationMs(path: string): Promise<number> {
  try {
    const { stdout } = await exec(resolveBin("ffprobe"), [
      "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path,
    ]);
    return Math.round(parseFloat(stdout.trim()) * 1000) || 0;
  } catch {
    return 0;
  }
}
