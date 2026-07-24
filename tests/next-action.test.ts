import { describe, expect, it } from "vitest";
import { computeNextAction, computeStages, type EpisodeSnapshot } from "@/lib/next-action";

const base: EpisodeSnapshot = {
  hasRawText: true,
  hasScript: false,
  characters: { total: 0, locked: 0, withCandidates: 0 },
  locations: { total: 0, locked: 0, withCandidates: 0 },
  scenes: 0,
  shots: { total: 0, withImage: 0, withVideo: 0 },
  storyboardConfirmed: false,
  isSrtMode: false,
  voiceLines: { total: 0, withAudio: 0 },
  hasExport: false,
  runningTaskTypes: [],
  failedTasks: 0,
};

describe("computeNextAction", () => {
  it("asks for raw text first", () => {
    const a = computeNextAction({ ...base, hasRawText: false }, "e1");
    expect(a.stage).toBe("input");
    expect(a.endpoint).toBeNull();
  });

  it("suggests script generation once text exists", () => {
    const a = computeNextAction(base, "e1");
    expect(a.stage).toBe("script");
    expect(a.endpoint).toBe("/api/episodes/e1/rewrite-script");
  });

  it("marks busy while the task runs", () => {
    const a = computeNextAction({ ...base, runningTaskTypes: ["REWRITE_SCRIPT"] }, "e1");
    expect(a.busy).toBe(true);
  });

  it("walks assets: extract → generate images → lock", () => {
    const withScript = { ...base, hasScript: true };
    expect(computeNextAction(withScript, "e1").endpoint).toContain("extract-assets");

    const extracted = { ...withScript, characters: { total: 2, locked: 0, withCandidates: 0 }, locations: { total: 1, locked: 0, withCandidates: 0 } };
    expect(computeNextAction(extracted, "e1").endpoint).toContain("generate-asset-images");

    const withCandidates = { ...extracted, characters: { total: 2, locked: 0, withCandidates: 2 }, locations: { total: 1, locked: 0, withCandidates: 1 } };
    const lockAction = computeNextAction(withCandidates, "e1");
    expect(lockAction.stage).toBe("assets");
    expect(lockAction.endpoint).toBeNull();
  });

  it("requires storyboard confirm gate before images", () => {
    const s: EpisodeSnapshot = {
      ...base,
      hasScript: true,
      characters: { total: 1, locked: 1, withCandidates: 1 },
      locations: { total: 1, locked: 1, withCandidates: 1 },
      scenes: 2,
      shots: { total: 5, withImage: 0, withVideo: 0 },
      storyboardConfirmed: false,
    };
    const a = computeNextAction(s, "e1");
    expect(a.stage).toBe("storyboard");
    expect(a.endpoint).toBeNull();
  });

  it("progresses images → videos → voice → compose → done", () => {
    const confirmed: EpisodeSnapshot = {
      ...base,
      hasScript: true,
      characters: { total: 1, locked: 1, withCandidates: 1 },
      locations: { total: 0, locked: 0, withCandidates: 0 },
      scenes: 2,
      shots: { total: 3, withImage: 0, withVideo: 0 },
      storyboardConfirmed: true,
    };
    expect(computeNextAction(confirmed, "e1").endpoint).toContain("generate-shot-images");

    const imaged = { ...confirmed, shots: { total: 3, withImage: 3, withVideo: 0 } };
    expect(computeNextAction(imaged, "e1").endpoint).toContain("generate-shot-videos");

    const videoed = { ...imaged, shots: { total: 3, withImage: 3, withVideo: 3 } };
    expect(computeNextAction(videoed, "e1").endpoint).toContain("/voice");

    const voiced = { ...videoed, voiceLines: { total: 2, withAudio: 2 } };
    expect(computeNextAction(voiced, "e1").endpoint).toContain("/compose");

    const done = { ...voiced, hasExport: true };
    const a = computeNextAction(done, "e1");
    expect(a.endpoint).toBeNull();
    expect(a.label).toContain("完成");
  });
});

describe("computeNextAction — SRT mode", () => {
  const srtBase: EpisodeSnapshot = { ...base, isSrtMode: true };

  it("skips the script stage and goes straight to assets", () => {
    const a = computeNextAction(srtBase, "e1");
    expect(a.stage).toBe("assets");
    expect(a.endpoint).toContain("extract-assets");
  });

  it("builds structure from SRT instead of the storyboard generator", () => {
    const locked: EpisodeSnapshot = {
      ...srtBase,
      characters: { total: 1, locked: 1, withCandidates: 1 },
      locations: { total: 0, locked: 0, withCandidates: 0 },
      scenes: 0,
      shots: { total: 0, withImage: 0, withVideo: 0 },
    };
    const a = computeNextAction(locked, "e1");
    expect(a.stage).toBe("storyboard");
    expect(a.endpoint).toContain("srt-build");
    expect(a.label).toContain("SRT");
  });

  it("still requires the storyboard confirm gate before images", () => {
    const built: EpisodeSnapshot = {
      ...srtBase,
      characters: { total: 1, locked: 1, withCandidates: 1 },
      scenes: 1,
      shots: { total: 4, withImage: 0, withVideo: 0 },
      storyboardConfirmed: false,
    };
    const a = computeNextAction(built, "e1");
    expect(a.stage).toBe("storyboard");
    expect(a.endpoint).toBeNull();
  });

  it("submits TTS via tts-all (no VOICE_ANALYZE) once shots have video", () => {
    const readyForVoice: EpisodeSnapshot = {
      ...srtBase,
      characters: { total: 1, locked: 1, withCandidates: 1 },
      scenes: 1,
      shots: { total: 3, withImage: 3, withVideo: 3 },
      storyboardConfirmed: true,
      voiceLines: { total: 3, withAudio: 0 },
    };
    const a = computeNextAction(readyForVoice, "e1");
    expect(a.stage).toBe("voice");
    expect(a.endpoint).toContain("tts-all");
  });
});

describe("computeStages", () => {
  it("reports per-stage counts", () => {
    const stages = computeStages({
      ...base,
      characters: { total: 2, locked: 1, withCandidates: 2 },
      locations: { total: 1, locked: 1, withCandidates: 1 },
      shots: { total: 4, withImage: 2, withVideo: 1 },
    });
    const assets = stages.find((s) => s.key === "assets");
    expect(assets?.count).toEqual({ done: 2, total: 3 });
    const images = stages.find((s) => s.key === "images");
    expect(images?.count).toEqual({ done: 2, total: 4 });
  });
});

describe("computeStages status + blockedBy", () => {
  const find = (s: EpisodeSnapshot, key: string) => computeStages(s).find((x) => x.key === key)!;

  it("locks a station whose prerequisite is missing and says what is missing", () => {
    const assets = find(base, "assets");
    expect(assets.status).toBe("blocked");
    expect(assets.blockedBy).toEqual(["第 2 站：先生成劇本"]);
  });

  it("marks the two human gates as review, not blocked", () => {
    const withCandidates = find(
      { ...base, hasScript: true, characters: { total: 2, locked: 0, withCandidates: 2 } },
      "assets",
    );
    expect(withCandidates.status).toBe("review");
    expect(withCandidates.blockedBy).toEqual([]);

    const unconfirmed = find(
      {
        ...base,
        hasScript: true,
        characters: { total: 1, locked: 1, withCandidates: 1 },
        shots: { total: 4, withImage: 0, withVideo: 0 },
        storyboardConfirmed: false,
      },
      "storyboard",
    );
    expect(unconfirmed.status).toBe("review");
  });

  it("reports done once the gate is passed", () => {
    const assets = find(
      { ...base, hasScript: true, characters: { total: 2, locked: 2, withCandidates: 2 } },
      "assets",
    );
    expect(assets.status).toBe("done");
    expect(assets.blockedBy).toEqual([]);
  });

  it("does not block on a script the SRT pipeline never produces", () => {
    const assets = find({ ...base, isSrtMode: true }, "assets");
    expect(assets.status).not.toBe("blocked");
    expect(find({ ...base, isSrtMode: true }, "script").status).toBe("done");
  });

  it("unlocks videos only once at least one image exists", () => {
    expect(find(base, "videos").status).toBe("blocked");
    const withOneImage = find({ ...base, shots: { total: 4, withImage: 1, withVideo: 0 } }, "videos");
    expect(withOneImage.status).toBe("todo");
    expect(withOneImage.blockedBy).toEqual([]);
  });

  it("never reports blockedBy on a finished station", () => {
    for (const s of computeStages({ ...base, hasExport: true, hasScript: true })) {
      if (s.done) expect(s.blockedBy).toEqual([]);
    }
  });
});
