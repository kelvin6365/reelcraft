import { describe, expect, it } from "vitest";
import { computeOpenRouterDiffs, perTokenStrToPerMTok, round8, type CatalogEntryLike } from "@/lib/pricing/sync-openrouter";

function textEntry(modelKey: string, inputPerMTok: number, outputPerMTok: number): CatalogEntryLike {
  return { modelKey, apiType: "text", pricing: { mode: "text", inputPerMTok, outputPerMTok, currency: "USD" } };
}

const flashEntry = textEntry("openrouter::google/gemini-2.5-flash", 0.3, 2.5);

describe("perTokenStrToPerMTok", () => {
  it("converts USD-per-token strings to per-MTok, killing float noise", () => {
    expect(perTokenStrToPerMTok("0.0000003")).toBe(0.3);
    expect(perTokenStrToPerMTok("0.0000025")).toBe(2.5);
    expect(perTokenStrToPerMTok("0")).toBe(0); // free models are a legit 0
  });

  it("rejects malformed or negative pricing", () => {
    expect(perTokenStrToPerMTok(undefined)).toBeNull();
    expect(perTokenStrToPerMTok("abc")).toBeNull();
    expect(perTokenStrToPerMTok("-0.000001")).toBeNull();
  });

  it("round8 clamps float noise", () => {
    expect(round8(0.30000000004)).toBe(0.3);
  });
});

describe("computeOpenRouterDiffs", () => {
  const liveFlash = { id: "google/gemini-2.5-flash", pricing: { prompt: "0.0000003", completion: "0.0000025" } };

  it("reports no diff when catalog matches live pricing (idempotent)", () => {
    const r = computeOpenRouterDiffs([flashEntry], [liveFlash]);
    expect(r.diffs).toEqual([]);
    expect(r.confirmed).toEqual(["openrouter::google/gemini-2.5-flash"]);
  });

  it("diffs drifted fields with current and provider values", () => {
    const stale = textEntry("openrouter::google/gemini-2.5-flash", 0.1, 2.5);
    const r = computeOpenRouterDiffs([stale], [liveFlash]);
    expect(r.diffs).toEqual([
      { modelKey: "openrouter::google/gemini-2.5-flash", field: "inputPerMTok", current: 0.1, provider: 0.3 },
    ]);
    expect(r.confirmed).toEqual([]);
  });

  it("flags catalog entries missing from the live list without touching them", () => {
    const gone = textEntry("openrouter::vendor/delisted-model", 1, 2);
    const r = computeOpenRouterDiffs([gone], [liveFlash]);
    expect(r.notFound).toEqual(["openrouter::vendor/delisted-model"]);
    expect(r.diffs).toEqual([]);
  });

  it("flags malformed live pricing instead of diffing against garbage", () => {
    const r = computeOpenRouterDiffs([flashEntry], [{ id: "google/gemini-2.5-flash", pricing: { prompt: "abc", completion: "0.0000025" } }]);
    expect(r.malformed).toEqual(["openrouter::google/gemini-2.5-flash"]);
    expect(r.diffs).toEqual([]);
  });

  it("skips fake:: and routes non-openrouter providers to unsyncable", () => {
    const catalog: CatalogEntryLike[] = [
      { modelKey: "fake::text", apiType: "text", pricing: { mode: "text", inputPerMTok: 0, outputPerMTok: 0 } },
      { modelKey: "fal::fal-ai/nano-banana", apiType: "image", pricing: { mode: "flat", perUnit: 0.039, unit: "image" } },
      flashEntry,
    ];
    const r = computeOpenRouterDiffs(catalog, [liveFlash]);
    expect(r.unsyncable).toEqual(["fal::fal-ai/nano-banana"]);
    expect(r.confirmed).toEqual(["openrouter::google/gemini-2.5-flash"]);
  });

  it("first occurrence wins on duplicate live ids", () => {
    const r = computeOpenRouterDiffs(
      [flashEntry],
      [liveFlash, { id: "google/gemini-2.5-flash", pricing: { prompt: "9", completion: "9" } }],
    );
    expect(r.diffs).toEqual([]);
  });
});
