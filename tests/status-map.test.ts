import { describe, it, expect } from "vitest";
import { STATUS_STATION_INDEX, stationIndexOf, continueLabel } from "@/ui/episode/status";

describe("stationIndexOf", () => {
  for (const [status, index] of Object.entries(STATUS_STATION_INDEX)) {
    it(`returns ${index} for "${status}"`, () => {
      expect(stationIndexOf(status)).toBe(index);
    });
  }

  it("falls back to 1 for an unknown status", () => {
    expect(stationIndexOf("bogus-status")).toBe(1);
  });
});

describe("continueLabel", () => {
  for (const status of Object.keys(STATUS_STATION_INDEX)) {
    it(`returns a non-empty label for "${status}"`, () => {
      expect(continueLabel(status).length).toBeGreaterThan(0);
    });
  }

  it("returns a sensible fallback for an unknown status", () => {
    expect(continueLabel("bogus-status")).toBe("進行中");
  });
});
