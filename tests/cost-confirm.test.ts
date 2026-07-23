import { describe, expect, it } from "vitest";
import { COST_CONFIRM_UNITS, COST_CONFIRM_USD, formatUsd, needsCostConfirm } from "@/ui/episode/cost-confirm";
import { statusLabel, statusVariant } from "@/ui/episode/status";

describe("needsCostConfirm", () => {
  it("asks before a batch that costs at or over the threshold", () => {
    expect(needsCostConfirm({ usd: COST_CONFIRM_USD })).toBe(true);
    expect(needsCostConfirm({ usd: 1.24 })).toBe(true);
  });

  it("stays out of the way for a single cheap generation", () => {
    expect(needsCostConfirm({ usd: 0.05, units: 1 })).toBe(false);
    expect(needsCostConfirm({ usd: 0.49 })).toBe(false);
  });

  it("asks for a large batch even with no price estimate", () => {
    expect(needsCostConfirm({ units: COST_CONFIRM_UNITS + 1 })).toBe(true);
    expect(needsCostConfirm({ usd: null, units: 40 })).toBe(true);
  });

  it("does not ask for a small batch with no price estimate", () => {
    expect(needsCostConfirm({ units: COST_CONFIRM_UNITS })).toBe(false);
    expect(needsCostConfirm({})).toBe(false);
    expect(needsCostConfirm({ usd: undefined, units: undefined })).toBe(false);
  });
});

describe("formatUsd", () => {
  it("renders two decimals with the approximate marker", () => {
    expect(formatUsd(1.2)).toBe("~US$1.20");
    expect(formatUsd(0)).toBe("~US$0.00");
  });
});

describe("statusLabel", () => {
  it("translates every status the schema documents", () => {
    for (const s of ["draft", "assets", "script", "storyboard", "images", "videos", "export", "done"]) {
      expect(statusLabel(s)).not.toBe(s);
    }
  });

  it("falls back to the raw value for an unknown status", () => {
    expect(statusLabel("something_new")).toBe("something_new");
  });

  it("highlights only the finished state", () => {
    expect(statusVariant("done")).toBe("default");
    expect(statusVariant("images")).toBe("outline");
  });
});

describe("MODEL_NO_REFERENCE_SUPPORT copy", () => {
  it("is terminal so the failure drawer hides retry", async () => {
    const { humanizeTaskError } = await import("@/lib/task/error-copy");
    const h = humanizeTaskError("MODEL_NO_REFERENCE_SUPPORT", "raw provider text");
    expect(h.terminal).toBe(true);
    expect(h.message).not.toBe("raw provider text");
  });
});

