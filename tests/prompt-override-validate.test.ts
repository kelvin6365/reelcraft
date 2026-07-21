import { describe, expect, it } from "vitest";
import { checkOverridePlaceholders, detectFormatDrop, extractPlaceholders, sortedDiff } from "@/lib/prompts/placeholders";

describe("extractPlaceholders", () => {
  it("finds every {name} placeholder", () => {
    expect([...extractPlaceholders("hello {a} and {b_2}")].sort()).toEqual(["a", "b_2"]);
  });

  it("ignores malformed placeholders (leading digit, empty)", () => {
    expect([...extractPlaceholders("{1bad} {} plain")]).toEqual([]);
  });
});

describe("sortedDiff", () => {
  it("reports missing and extra, sorted", () => {
    const { missing, extra } = sortedDiff(new Set(["a", "b", "c"]), new Set(["b", "d"]));
    expect(missing).toEqual(["a", "c"]);
    expect(extra).toEqual(["d"]);
  });
});

describe("checkOverridePlaceholders", () => {
  it("passes when the placeholder set exactly matches declared vars", () => {
    const r = checkOverridePlaceholders(["a", "b"], "{a} then {b}");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  it("fails with missing[] when a declared var is absent from the content", () => {
    const r = checkOverridePlaceholders(["a", "b"], "{a} only");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("PROMPT_OVERRIDE_INVALID");
      expect(r.missing).toEqual(["b"]);
      expect(r.extra).toEqual([]);
    }
  });

  it("fails with extra[] when the content has an undeclared placeholder", () => {
    const r = checkOverridePlaceholders(["a"], "{a} plus {bogus}");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toEqual([]);
      expect(r.extra).toEqual(["bogus"]);
    }
  });

  it("fails when both missing and extra are present simultaneously", () => {
    const r = checkOverridePlaceholders(["a", "b"], "{a} plus {c}");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toEqual(["b"]);
      expect(r.extra).toEqual(["c"]);
    }
  });
});

describe("detectFormatDrop", () => {
  it("returns no warning when the system template has no format markers", () => {
    expect(detectFormatDrop("plain instructions, no format hints", "anything")).toEqual([]);
  });

  it("returns no warning when the override still carries a format marker", () => {
    const system = "請只輸出 JSON，唔准夾雜其他文字";
    const override = "回傳 JSON 格式";
    expect(detectFormatDrop(system, override)).toEqual([]);
  });

  it("warns when the system template has format markers the override appears to drop", () => {
    const system = "請只輸出 JSON，唔准夾雜其他文字";
    const override = "隨便寫啲嘢啦";
    expect(detectFormatDrop(system, override)).toHaveLength(1);
  });

  it("never fails ok, only returns a warning array — non-blocking by construction", () => {
    const warnings = detectFormatDrop("```json\n{}\n```", "no format info at all");
    expect(Array.isArray(warnings)).toBe(true);
  });
});
