// Pure display-name helper for the PR4 station chips — no DB, no env seeding
// needed since src/ui/model-format.ts has zero imports.
import { describe, expect, it } from "vitest";
import { isFakeModel, shortModelName } from "@/ui/model-format";

describe("shortModelName", () => {
  it("shortens a versioned model id to family-version", () => {
    expect(shortModelName("fal::fal-ai/kling-video/v3/standard/image-to-video")).toBe("kling-v3");
  });

  it("keeps a single meaningful segment as-is", () => {
    expect(shortModelName("fal::fal-ai/nano-banana-pro")).toBe("nano-banana-pro");
  });

  it("drops the vendor/org segment for openrouter models", () => {
    expect(shortModelName("openrouter::google/gemini-2.5-flash-lite")).toBe("gemini-2.5-flash-lite");
  });

  it("flags fake:: models distinctly instead of shortening them", () => {
    expect(shortModelName("fake::video")).toBe("fake（測試）");
    expect(shortModelName("fake::image")).toBe("fake（測試）");
  });
});

describe("isFakeModel", () => {
  it("is true only for the fake:: provider prefix", () => {
    expect(isFakeModel("fake::video")).toBe(true);
    expect(isFakeModel("fal::fal-ai/nano-banana-pro")).toBe(false);
  });
});
