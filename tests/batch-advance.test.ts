// Batch advance engine: nextAction → task mapping, review gates, skipVideo.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EpisodeSnapshot } from "@/lib/next-action";

const { submitTask, buildEpisodeSnapshot, episodeFindUnique, episodeUpdate, shotFindMany, characterFindMany, locationFindMany, voiceLineFindMany } = vi.hoisted(() => ({
  submitTask: vi.fn(async () => ({ taskId: "t1", deduped: false })),
  buildEpisodeSnapshot: vi.fn(),
  episodeFindUnique: vi.fn(),
  episodeUpdate: vi.fn(async () => ({})),
  shotFindMany: vi.fn(async () => [] as unknown[]),
  characterFindMany: vi.fn(async () => [] as unknown[]),
  locationFindMany: vi.fn(async () => [] as unknown[]),
  voiceLineFindMany: vi.fn(async () => [] as unknown[]),
}));

vi.mock("@/lib/task/submit", () => ({ submitTask }));
vi.mock("@/lib/api/episode-snapshot", () => ({ buildEpisodeSnapshot }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    episode: { findUnique: episodeFindUnique, update: episodeUpdate },
    shot: { findMany: shotFindMany },
    character: { findMany: characterFindMany },
    location: { findMany: locationFindMany },
    voiceLine: { findMany: voiceLineFindMany },
  },
}));

import { advanceEpisode } from "@/lib/batch/advance";

const baseSnapshot: EpisodeSnapshot = {
  hasRawText: true,
  hasScript: false,
  characters: { total: 2, locked: 2, withCandidates: 2 },
  locations: { total: 1, locked: 1, withCandidates: 1 },
  scenes: 0,
  shots: { total: 0, withImage: 0, withVideo: 0 },
  storyboardConfirmed: false,
  isSrtMode: false,
  voiceLines: { total: 0, withAudio: 0 },
  hasExport: false,
  runningTaskTypes: [],
  failedTasks: 0,
};

function mockEpisode(config: Record<string, unknown> = {}, autorun = true) {
  episodeFindUnique.mockResolvedValue({
    id: "e1",
    userId: "u1",
    projectId: "p1",
    autorun,
    autorunConfig: config,
    project: { inputType: "novel" },
  });
}

function mockSnapshot(...snapshots: Partial<EpisodeSnapshot>[]) {
  for (const s of snapshots) {
    buildEpisodeSnapshot.mockResolvedValueOnce({ snapshot: { ...baseSnapshot, ...s }, characters: [], locations: [], shots: [], voiceLines: [] });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  submitTask.mockResolvedValue({ taskId: "t1", deduped: false });
});

describe("advanceEpisode", () => {
  it("no-ops when autorun is off", async () => {
    mockEpisode({}, false);
    expect(await advanceEpisode("e1")).toBe("not-autorun");
    expect(submitTask).not.toHaveBeenCalled();
  });

  it("no-ops while a related task is running", async () => {
    mockEpisode();
    mockSnapshot({ runningTaskTypes: ["REWRITE_SCRIPT"] });
    expect(await advanceEpisode("e1")).toBe("busy");
    expect(submitTask).not.toHaveBeenCalled();
  });

  it("submits REWRITE_SCRIPT at the script stage", async () => {
    mockEpisode();
    mockSnapshot({});
    expect(await advanceEpisode("e1")).toBe("rewrite-script");
    expect(submitTask).toHaveBeenCalledWith(expect.objectContaining({ type: "REWRITE_SCRIPT", episodeId: "e1", userId: "u1", projectId: "p1" }));
  });

  it("submits deterministic {at:0} payloads — resolved model keys never enter the payload", async () => {
    // Model resolution happens at run time in the worker, NOT at enqueue, so the
    // batch payload must stay the fixed {at:0} that the dedupeKey hash relies on.
    // A resolved provider::modelId leaking in here would break batch dedupe.
    mockEpisode();
    mockSnapshot({});
    await advanceEpisode("e1");
    expect(submitTask).toHaveBeenCalledWith(expect.objectContaining({ type: "REWRITE_SCRIPT", payload: { at: 0 } }));
    const arg = (submitTask.mock.calls[0] as unknown[])[0] as { payload: Record<string, unknown> };
    const payload = arg.payload;
    expect(Object.keys(payload)).toEqual(["at"]);
    for (const slot of ["text", "image", "video", "tts", "modelKey"]) {
      expect(payload).not.toHaveProperty(slot);
    }
  });

  it("pauses at the assets lock gate (human review)", async () => {
    mockEpisode();
    mockSnapshot({ hasScript: true, characters: { total: 2, locked: 1, withCandidates: 2 } });
    expect(await advanceEpisode("e1")).toBe("paused:lock-assets");
    expect(submitTask).not.toHaveBeenCalled();
  });

  it("submits BUILD_SCENES→STORYBOARD_RUN once assets are locked", async () => {
    mockEpisode();
    mockSnapshot({ hasScript: true });
    expect(await advanceEpisode("e1")).toBe("storyboard");
    expect(submitTask).toHaveBeenCalledWith(
      expect.objectContaining({ type: "BUILD_SCENES", payload: expect.objectContaining({ then: "STORYBOARD_RUN" }) }),
    );
  });

  it("pauses at storyboard confirm when autoConfirmStoryboard is off", async () => {
    mockEpisode({ autoConfirmStoryboard: false });
    mockSnapshot({ hasScript: true, scenes: 1, shots: { total: 3, withImage: 0, withVideo: 0 } });
    expect(await advanceEpisode("e1")).toBe("paused:confirm-storyboard");
    expect(episodeUpdate).not.toHaveBeenCalled();
  });

  it("auto-confirms storyboard then fans out shot images", async () => {
    mockEpisode({ autoConfirmStoryboard: true });
    // first pass: at confirm gate; second pass (post-confirm): images stage
    mockSnapshot(
      { hasScript: true, scenes: 1, shots: { total: 2, withImage: 0, withVideo: 0 } },
      { hasScript: true, scenes: 1, shots: { total: 2, withImage: 0, withVideo: 0 }, storyboardConfirmed: true },
    );
    // re-fetch on the recursive advance
    mockEpisode({ autoConfirmStoryboard: true });
    shotFindMany.mockResolvedValue([{ id: "s1" }, { id: "s2" }]);
    expect(await advanceEpisode("e1")).toBe("shot-images:2");
    expect(episodeUpdate).toHaveBeenCalledWith({ where: { id: "e1" }, data: { status: "images" } });
    expect(submitTask).toHaveBeenCalledTimes(2);
    expect(submitTask).toHaveBeenCalledWith(expect.objectContaining({ type: "IMAGE_SHOT", targetId: "s1" }));
  });

  it("skipVideo jumps from images-done straight to voice", async () => {
    mockEpisode({ skipVideo: true });
    mockSnapshot({ hasScript: true, scenes: 1, shots: { total: 2, withImage: 2, withVideo: 0 }, storyboardConfirmed: true });
    expect(await advanceEpisode("e1")).toBe("voice-analyze");
    expect(submitTask).toHaveBeenCalledWith(expect.objectContaining({ type: "VOICE_ANALYZE" }));
  });

  it("without skipVideo, fans out shot videos", async () => {
    mockEpisode();
    mockSnapshot({ hasScript: true, scenes: 1, shots: { total: 2, withImage: 2, withVideo: 0 }, storyboardConfirmed: true });
    shotFindMany.mockResolvedValue([{ id: "s1" }, { id: "s2" }]);
    expect(await advanceEpisode("e1")).toBe("shot-videos:2");
    expect(submitTask).toHaveBeenCalledWith(expect.objectContaining({ type: "VIDEO_SHOT", targetId: "s1" }));
  });

  it("submits COMPOSE_EPISODE when voice is done", async () => {
    mockEpisode();
    mockSnapshot({
      hasScript: true, scenes: 1, storyboardConfirmed: true,
      shots: { total: 2, withImage: 2, withVideo: 2 },
      voiceLines: { total: 3, withAudio: 3 },
    });
    expect(await advanceEpisode("e1")).toBe("compose");
    expect(submitTask).toHaveBeenCalledWith(expect.objectContaining({ type: "COMPOSE_EPISODE" }));
  });

  it("clears autorun when the episode is done", async () => {
    mockEpisode();
    mockSnapshot({
      hasScript: true, scenes: 1, storyboardConfirmed: true,
      shots: { total: 2, withImage: 2, withVideo: 2 },
      voiceLines: { total: 3, withAudio: 3 },
      hasExport: true,
    });
    expect(await advanceEpisode("e1")).toBe("done");
    expect(episodeUpdate).toHaveBeenCalledWith({ where: { id: "e1" }, data: { autorun: false } });
    expect(submitTask).not.toHaveBeenCalled();
  });

  describe("assisted mode", () => {
    it("still submits free stages automatically (rewrite-script)", async () => {
      mockEpisode({ mode: "assisted" });
      mockSnapshot({});
      expect(await advanceEpisode("e1")).toBe("rewrite-script");
      expect(submitTask).toHaveBeenCalledWith(expect.objectContaining({ type: "REWRITE_SCRIPT" }));
    });

    it("pauses at generate-asset-images (checkpoint 1) with zero submits", async () => {
      mockEpisode({ mode: "assisted" });
      mockSnapshot({ hasScript: true, characters: { total: 2, locked: 0, withCandidates: 0 } });
      expect(await advanceEpisode("e1")).toBe("paused:asset-images");
      expect(submitTask).not.toHaveBeenCalled();
    });

    it("pauses at shot-images without moneyAuthorized", async () => {
      mockEpisode({ mode: "assisted" });
      mockSnapshot({ hasScript: true, scenes: 1, storyboardConfirmed: true, shots: { total: 2, withImage: 0, withVideo: 0 } });
      expect(await advanceEpisode("e1")).toBe("paused:money");
      expect(submitTask).not.toHaveBeenCalled();
    });

    it("fans out shot-images normally once moneyAuthorized", async () => {
      mockEpisode({ mode: "assisted", moneyAuthorized: true });
      mockSnapshot({ hasScript: true, scenes: 1, storyboardConfirmed: true, shots: { total: 2, withImage: 0, withVideo: 0 } });
      shotFindMany.mockResolvedValue([{ id: "s1" }, { id: "s2" }]);
      expect(await advanceEpisode("e1")).toBe("shot-images:2");
      expect(submitTask).toHaveBeenCalledWith(expect.objectContaining({ type: "IMAGE_SHOT", targetId: "s1" }));
    });

    it("still pauses at the storyboard confirm gate (assisted never sets autoConfirmStoryboard)", async () => {
      mockEpisode({ mode: "assisted" });
      mockSnapshot({ hasScript: true, scenes: 1, shots: { total: 3, withImage: 0, withVideo: 0 } });
      expect(await advanceEpisode("e1")).toBe("paused:confirm-storyboard");
      expect(episodeUpdate).not.toHaveBeenCalled();
    });
  });

  it("SRT mode: builds structure via SRT_BUILD then fans out tts-all", async () => {
    episodeFindUnique.mockResolvedValue({
      id: "e1", userId: "u1", projectId: "p1", autorun: true, autorunConfig: {},
      project: { inputType: "srt" },
    });
    mockSnapshot({ isSrtMode: true });
    expect(await advanceEpisode("e1")).toBe("srt-build");
    expect(submitTask).toHaveBeenCalledWith(expect.objectContaining({ type: "SRT_BUILD" }));
  });
});
