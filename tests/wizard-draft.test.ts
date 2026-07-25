import { describe, expect, it } from "vitest";
import { defaultDraft, defaultName, parseDraft } from "@/ui/wizard/draft";

describe("defaultName", () => {
  it("truncates to 12 characters", () => {
    expect(defaultName("一二三四五六七八九十十一十二十三十四")).toBe("一二三四五六七八九十十一");
  });

  it("collapses whitespace", () => {
    expect(defaultName("  hello   world  ")).toBe("hello world");
  });

  it("falls back to 未命名專案 when empty", () => {
    expect(defaultName("")).toBe("未命名專案");
    expect(defaultName("   ")).toBe("未命名專案");
  });
});

describe("parseDraft", () => {
  it("returns null for null input", () => {
    expect(parseDraft(null)).toBeNull();
  });

  it("returns null for garbage string", () => {
    expect(parseDraft("not json{{")).toBeNull();
    expect(parseDraft("42")).toBeNull();
    expect(parseDraft('"just a string"')).toBeNull();
  });

  it("returns null for JSON with wrong shape", () => {
    expect(parseDraft(JSON.stringify({ step: 1 }))).toBeNull();
    expect(parseDraft(JSON.stringify({ ...defaultDraft(), step: 4 }))).toBeNull();
    expect(parseDraft(JSON.stringify({ ...defaultDraft(), inputType: "pdf" }))).toBeNull();
    expect(parseDraft(JSON.stringify({ ...defaultDraft(), videoRatio: "4:3" }))).toBeNull();
    expect(parseDraft(JSON.stringify({ ...defaultDraft(), mode: "batch" }))).toBeNull();
    expect(
      parseDraft(JSON.stringify({ ...defaultDraft(), planConfig: { ...defaultDraft().planConfig, anchor: "bad" } })),
    ).toBeNull();
    expect(
      parseDraft(
        JSON.stringify({ ...defaultDraft(), planConfig: { ...defaultDraft().planConfig, hookStrength: "loud" } }),
      ),
    ).toBeNull();
    expect(
      parseDraft(JSON.stringify({ ...defaultDraft(), planConfig: { ...defaultDraft().planConfig, seconds: "90" } })),
    ).toBeNull();
  });

  it("roundtrips a valid defaultDraft", () => {
    const d = defaultDraft();
    expect(parseDraft(JSON.stringify(d))).toEqual(d);
  });
});

describe("defaultDraft", () => {
  it("has the expected shape and values", () => {
    expect(defaultDraft()).toEqual({
      step: 1,
      text: "",
      inputType: "novel",
      stylePackId: "cinematic-01",
      videoRatio: "9:16",
      mode: "single",
      planConfig: { anchor: "length", seconds: 90, count: 12, hookStrength: "strong" },
      name: "",
    });
  });
});
