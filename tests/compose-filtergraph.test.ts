// buildTimedComposeArgs 係純 args builder：唔使起 ffmpeg 就鎖住 filtergraph 結構。
// 重點：adelay 逐句釘位、amix 唔壓音量、atrim+apad 令視頻做 master（冇 -shortest）、
// drawtext enable 窗口跟 placeLines、escape 齊全、冇 drawtext build 時降級。
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgres://user:pw@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.STORAGE_ENDPOINT ??= "http://localhost:9000";
process.env.STORAGE_BUCKET ??= "test";
process.env.STORAGE_ACCESS_KEY ??= "test";
process.env.STORAGE_SECRET_KEY ??= "test";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.API_ENCRYPTION_KEY ??= "y".repeat(32);

// ffmpeg.ts imports @/lib/env（fail-fast module），所以要喺 env stub 之後動態 import
type Ffmpeg = typeof import("@/lib/video/ffmpeg");
let buildTimedComposeArgs: Ffmpeg["buildTimedComposeArgs"];
let escapeDrawtextText: Ffmpeg["escapeDrawtextText"];
beforeAll(async () => {
  ({ buildTimedComposeArgs, escapeDrawtextText } = await import("@/lib/video/ffmpeg"));
});

const base = {
  videoPath: "/tmp/clip.mp4",
  clipDurationMs: 6000,
};

const graphOf = (args: string[]) => {
  const i = args.indexOf("-filter_complex");
  return i === -1 ? "" : args[i + 1];
};

describe("buildTimedComposeArgs", () => {
  it("single line: adelay + atrim/apad, no amix", () => {
    const args = buildTimedComposeArgs(
      { ...base, audio: [{ path: "/tmp/a0.m4a", startMs: 1500 }], subtitles: [] },
      "/tmp/out.mp4",
      false,
    );
    const graph = graphOf(args);
    expect(graph).toContain("[1:a:0]adelay=1500:all=1[a0]");
    expect(graph).not.toContain("amix");
    expect(graph).toContain("[a0]atrim=end=6.000,apad=whole_dur=6.000[aout]");
    expect(args).toContain("-map");
    expect(args[args.indexOf("-map") + 1]).toBe("0:v:0"); // no subtitles → raw video map
    expect(args).toContain("[aout]");
    expect(args).not.toContain("-shortest");
    expect(args).toContain("-c:a");
  });

  it("multi line: per-input adelay then amix normalize=0", () => {
    const args = buildTimedComposeArgs(
      {
        ...base,
        audio: [
          { path: "/tmp/a0.m4a", startMs: 0 },
          { path: "/tmp/a1.m4a", startMs: 3000 },
        ],
        subtitles: [],
      },
      "/tmp/out.mp4",
      false,
    );
    const graph = graphOf(args);
    expect(graph).toContain("[1:a:0]adelay=0:all=1[a0]");
    expect(graph).toContain("[2:a:0]adelay=3000:all=1[a1]");
    expect(graph).toContain("[a0][a1]amix=inputs=2:normalize=0[am]");
    expect(graph).toContain("[am]atrim=end=6.000,apad=whole_dur=6.000[aout]");
    // both audio files are ffmpeg inputs after the video
    expect(args.filter((a) => a === "-i")).toHaveLength(3);
  });

  it("subtitles burn with per-line enable windows, end clamped to clip length", () => {
    const args = buildTimedComposeArgs(
      {
        ...base,
        audio: [{ path: "/tmp/a0.m4a", startMs: 0 }],
        subtitles: [
          { text: "第一句", startMs: 0, endMs: 2400 },
          { text: "第二句", startMs: 4000, endMs: 9000 }, // overflows 6s clip
        ],
      },
      "/tmp/out.mp4",
      true,
    );
    const graph = graphOf(args);
    expect(graph).toContain("drawtext=text='第一句':enable='between(t,0.000,2.400)'");
    expect(graph).toContain("drawtext=text='第二句':enable='between(t,4.000,6.000)'"); // clamped
    expect(graph).toContain("[0:v]");
    expect(graph).toContain("[vout]");
    expect(args[args.indexOf("-map") + 1]).toBe("[vout]");
  });

  it("drops empty-text and zero-width subtitle windows", () => {
    const args = buildTimedComposeArgs(
      {
        ...base,
        audio: [],
        subtitles: [
          { text: "", startMs: 0, endMs: 1000 },
          { text: "尾後", startMs: 6000, endMs: 8000 }, // starts at clip end → zero width after clamp
        ],
      },
      "/tmp/out.mp4",
      true,
    );
    expect(graphOf(args)).toBe(""); // nothing to draw, no audio → no filter_complex
    expect(args[args.indexOf("-map") + 1]).toBe("0:v:0");
  });

  it("drawtext=false degrades to raw video map even with subtitles", () => {
    const args = buildTimedComposeArgs(
      { ...base, audio: [{ path: "/tmp/a0.m4a", startMs: 0 }], subtitles: [{ text: "字幕", startMs: 0, endMs: 2000 }] },
      "/tmp/out.mp4",
      false,
    );
    expect(graphOf(args)).not.toContain("drawtext");
    expect(args[args.indexOf("-map") + 1]).toBe("0:v:0");
  });

  it("no audio → no -c:a and no [aout] map", () => {
    const args = buildTimedComposeArgs({ ...base, audio: [], subtitles: [] }, "/tmp/out.mp4", false);
    expect(args).not.toContain("-c:a");
    expect(args).not.toContain("[aout]");
  });

  it("negative/fractional startMs is clamped and rounded in adelay", () => {
    const args = buildTimedComposeArgs(
      { ...base, audio: [{ path: "/tmp/a0.m4a", startMs: -100.6 }], subtitles: [] },
      "/tmp/out.mp4",
      false,
    );
    expect(graphOf(args)).toContain("adelay=0:all=1");
  });
});

describe("escapeDrawtextText", () => {
  it("escapes backslash, quote, colon and percent", () => {
    expect(escapeDrawtextText("a\\b'c:d%e")).toBe("a\\\\b\\'c\\:d\\%e");
  });
});
