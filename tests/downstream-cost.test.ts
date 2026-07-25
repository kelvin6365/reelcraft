// estimateDownstreamCost — estVoiceUsd worst-case pricing (docs/plans/... assisted auto-advance).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { episodeFindUniqueOrThrow, shotFindMany, resolveModelDefaults, getCapabilityEntry } = vi.hoisted(() => ({
  episodeFindUniqueOrThrow: vi.fn(),
  shotFindMany: vi.fn(async () => [] as unknown[]),
  resolveModelDefaults: vi.fn(),
  getCapabilityEntry: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    episode: { findUniqueOrThrow: episodeFindUniqueOrThrow },
    shot: { findMany: shotFindMany },
    project: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/model-defaults/resolve", () => ({ resolveModelDefaults }));
vi.mock("@/lib/ai/capabilities", () => ({ getCapabilityEntry }));
vi.mock("@/lib/billing/actual-cost", () => ({ sumActualCostUsd: vi.fn(async () => 0) }));

import { estimateDownstreamCost } from "@/lib/billing/budget";

function mockModels(image: string, video: string, tts: string) {
  resolveModelDefaults.mockResolvedValue({ image, video, tts });
}

beforeEach(() => {
  vi.clearAllMocks();
  shotFindMany.mockResolvedValue([]);
  episodeFindUniqueOrThrow.mockResolvedValue({
    id: "e1",
    scriptText: "x".repeat(100),
    project: { modelDefaults: {} },
  });
});

describe("estimateDownstreamCost — estVoiceUsd", () => {
  it("computes scriptText.length × perChar for the resolved TTS model", async () => {
    mockModels("fake::image", "fake::video", "real::tts");
    getCapabilityEntry.mockImplementation((key: string) => {
      if (key === "real::tts") return { pricing: { mode: "flat", unit: "character", perUnit: 0.0001, currency: "USD" } };
      return null;
    });
    const est = await estimateDownstreamCost("u1", "e1");
    expect(est.estVoiceUsd).toBeCloseTo(100 * 0.0001);
  });

  it("is 0 when the tts model has no price (fake/unknown)", async () => {
    mockModels("fake::image", "fake::video", "fake::tts");
    getCapabilityEntry.mockReturnValue(null);
    const est = await estimateDownstreamCost("u1", "e1");
    expect(est.estVoiceUsd).toBe(0);
  });

  it("is included in totalUsd alongside image/video", async () => {
    mockModels("real::image", "real::video", "real::tts");
    shotFindMany.mockResolvedValue([
      { imageMediaId: null, videoMediaId: null, durationMs: null },
    ]);
    getCapabilityEntry.mockImplementation((key: string) => {
      if (key === "real::image") return { pricing: { mode: "flat", unit: "image", perUnit: 0.05, currency: "USD" } };
      if (key === "real::video") return { pricing: { mode: "flat", unit: "second", perUnit: 0.1, currency: "USD" }, capabilities: { durationsSec: [5] } };
      if (key === "real::tts") return { pricing: { mode: "flat", unit: "character", perUnit: 0.0002, currency: "USD" } };
      return null;
    });
    const est = await estimateDownstreamCost("u1", "e1");
    expect(est.estImageUsd).toBeCloseTo(0.05);
    expect(est.estVideoUsd).toBeCloseTo(0.5);
    expect(est.estVoiceUsd).toBeCloseTo(100 * 0.0002);
    expect(est.totalUsd).toBeCloseTo(est.estImageUsd + est.estVideoUsd + est.estVoiceUsd);
  });
});
