import { describe, expect, it } from "vitest";
import { aggregateUsage, dayKey, type UsageLogRow } from "@/lib/usage";

// Fixture: a plain ai_call_logs row with sensible defaults, override per case.
function row(over: Partial<UsageLogRow> = {}): UsageLogRow {
  return {
    at: new Date("2026-07-10T08:00:00.000Z"),
    modelKey: "openrouter::anthropic/claude-sonnet-4.5",
    apiType: "text",
    promptId: "rewrite_script",
    promptVersion: "1",
    projectId: "p1",
    episodeId: "e1",
    episodeNumber: 1,
    inputTokens: 100,
    outputTokens: 50,
    cachedInputTokens: null,
    quantity: null,
    unit: null,
    estCostUsd: 0.01,
    providerCostUsd: null,
    latencyMs: 200,
    status: "ok",
    errorCode: null,
    ...over,
  };
}

describe("aggregateUsage — totals", () => {
  it("sums cost, tokens, calls and computes error rate", () => {
    const rows = [
      row({ estCostUsd: 0.02, inputTokens: 100, outputTokens: 50, latencyMs: 100 }),
      row({ estCostUsd: 0.03, inputTokens: 200, outputTokens: 80, latencyMs: 300 }),
      row({ status: "error", errorCode: "PROVIDER_5XX", estCostUsd: 0, inputTokens: 0, outputTokens: 0, latencyMs: 50 }),
    ];
    const { totals } = aggregateUsage(rows, "day");
    expect(totals.calls).toBe(3);
    expect(totals.estCostUsd).toBeCloseTo(0.05, 6);
    expect(totals.inputTokens).toBe(300);
    expect(totals.outputTokens).toBe(130);
    expect(totals.errorCount).toBe(1);
    expect(totals.errorRate).toBeCloseTo(1 / 3, 6);
    expect(totals.avgLatencyMs).toBe(150); // (100+300+50)/3
  });

  it("counts null-cost rows as 未計價 and excludes them from the cost sum", () => {
    const rows = [row({ estCostUsd: 0.01 }), row({ estCostUsd: null }), row({ estCostUsd: null })];
    const { totals } = aggregateUsage(rows, "day");
    expect(totals.estCostUsd).toBeCloseTo(0.01, 6);
    expect(totals.uncostedCalls).toBe(2);
    expect(totals.calls).toBe(3);
  });

  it("handles empty input without dividing by zero", () => {
    const { rows, totals, errorTop } = aggregateUsage([], "day");
    expect(rows).toEqual([]);
    expect(totals.calls).toBe(0);
    expect(totals.errorRate).toBe(0);
    expect(totals.avgLatencyMs).toBe(0);
    expect(errorTop).toEqual([]);
  });
});

describe("aggregateUsage — provider cost vs estimate", () => {
  it("prefers the provider-billed cost per row for actualCostUsd", () => {
    const rows = [
      row({ estCostUsd: 0.01, providerCostUsd: 0.008 }), // real bill beats estimate
      row({ estCostUsd: 0.02, providerCostUsd: null }), // no bill → estimate
      row({ estCostUsd: null, providerCostUsd: null }), // fully uncosted
    ];
    const { totals } = aggregateUsage(rows, "day");
    expect(totals.actualCostUsd).toBeCloseTo(0.028, 6);
    expect(totals.estCostUsd).toBeCloseTo(0.03, 6);
    expect(totals.providerCostUsd).toBeCloseTo(0.008, 6);
    expect(totals.providerCostedCalls).toBe(1);
    expect(totals.estCostOnProviderCostedUsd).toBeCloseTo(0.01, 6);
    expect(totals.uncostedCalls).toBe(1); // semantics unchanged
  });

  it("respects a provider-billed cost of 0 (free model) instead of falling back", () => {
    const rows = [row({ estCostUsd: 0.05, providerCostUsd: 0 })];
    const { totals } = aggregateUsage(rows, "day");
    expect(totals.actualCostUsd).toBe(0);
    expect(totals.providerCostedCalls).toBe(1);
  });

  it("sorts model groups by actualCostUsd, not the raw estimate", () => {
    const rows = [
      row({ modelKey: "a::over-estimated", estCostUsd: 0.9, providerCostUsd: 0.01 }),
      row({ modelKey: "b::real-spender", estCostUsd: 0.05, providerCostUsd: 0.5 }),
    ];
    const { rows: out } = aggregateUsage(rows, "model");
    expect(out.map((r) => r.key)).toEqual(["b::real-spender", "a::over-estimated"]);
  });
});

describe("aggregateUsage — grouping", () => {
  it("buckets by UTC day and returns rows chronologically", () => {
    const rows = [
      row({ at: new Date("2026-07-12T23:00:00Z"), estCostUsd: 0.05 }),
      row({ at: new Date("2026-07-10T01:00:00Z"), estCostUsd: 0.01 }),
      row({ at: new Date("2026-07-10T22:00:00Z"), estCostUsd: 0.02 }),
    ];
    const { rows: out } = aggregateUsage(rows, "day");
    expect(out.map((r) => r.key)).toEqual(["2026-07-10", "2026-07-12"]);
    expect(out[0].calls).toBe(2);
    expect(out[0].estCostUsd).toBeCloseTo(0.03, 6);
    expect(out[1].estCostUsd).toBeCloseTo(0.05, 6);
  });

  it("groups by model sorted by cost desc", () => {
    const rows = [
      row({ modelKey: "a::cheap", estCostUsd: 0.01 }),
      row({ modelKey: "b::pricey", estCostUsd: 0.5 }),
      row({ modelKey: "a::cheap", estCostUsd: 0.02 }),
    ];
    const { rows: out } = aggregateUsage(rows, "model");
    expect(out.map((r) => r.key)).toEqual(["b::pricey", "a::cheap"]);
    expect(out[1].calls).toBe(2);
    expect(out[1].estCostUsd).toBeCloseTo(0.03, 6);
  });

  it("labels episodes by number and falls back for null episodeId", () => {
    const rows = [
      row({ episodeId: "e2", episodeNumber: 7, estCostUsd: 0.9 }),
      row({ episodeId: null, episodeNumber: null, estCostUsd: 0.1 }),
    ];
    const { rows: out } = aggregateUsage(rows, "episode");
    expect(out[0].label).toBe("第 7 集");
    expect(out[1].key).toBe("__none__");
    expect(out[1].label).toBe("（無集）");
  });

  it("ranks prompts by token spend desc, versioned key", () => {
    const rows = [
      row({ promptId: "storyboard_plan", promptVersion: "2", inputTokens: 100, outputTokens: 50 }),
      row({ promptId: "extract_assets", promptVersion: "1", inputTokens: 900, outputTokens: 400 }),
      row({ promptId: "storyboard_plan", promptVersion: "2", inputTokens: 200, outputTokens: 80 }),
      row({ promptId: null, promptVersion: null, inputTokens: 10, outputTokens: 5 }),
    ];
    const { rows: out } = aggregateUsage(rows, "prompt");
    expect(out[0].key).toBe("extract_assets@1"); // 1300 tokens, most
    expect(out[1].key).toBe("storyboard_plan@2"); // 430 tokens, 2 calls
    expect(out[1].calls).toBe(2);
    expect(out[2].label).toBe("（無 prompt）");
  });

  it("accumulates media quantity by unit", () => {
    const rows = [
      row({ apiType: "image", unit: "image", quantity: 3 }),
      row({ apiType: "image", unit: "image", quantity: 2 }),
      row({ apiType: "tts", unit: "char", quantity: 500 }),
    ];
    const { rows: out } = aggregateUsage(rows, "apiType");
    const img = out.find((r) => r.key === "image");
    const tts = out.find((r) => r.key === "tts");
    expect(img?.quantityByUnit).toEqual({ image: 5 });
    expect(tts?.quantityByUnit).toEqual({ char: 500 });
  });
});

describe("aggregateUsage — errorTop", () => {
  it("ranks error codes by frequency", () => {
    const rows = [
      row({ status: "error", errorCode: "RATE_LIMIT" }),
      row({ status: "error", errorCode: "RATE_LIMIT" }),
      row({ status: "error", errorCode: "TIMEOUT" }),
      row({ status: "error", errorCode: null }), // → UNKNOWN
      row({ status: "ok" }),
    ];
    const { errorTop } = aggregateUsage(rows, "day");
    expect(errorTop).toEqual([
      { errorCode: "RATE_LIMIT", count: 2 },
      { errorCode: "TIMEOUT", count: 1 },
      { errorCode: "UNKNOWN", count: 1 },
    ]);
  });
});

describe("dayKey", () => {
  it("formats a UTC YYYY-MM-DD", () => {
    expect(dayKey(new Date("2026-07-18T15:30:00Z"))).toBe("2026-07-18");
  });
});
