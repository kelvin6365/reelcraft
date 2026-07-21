import { describe, expect, it } from "vitest";
import { diffLines } from "@/lib/prompts/diff";

describe("diffLines", () => {
  it("marks identical text as all same", () => {
    const r = diffLines("a\nb\nc", "a\nb\nc");
    expect(r).toEqual([
      { type: "same", text: "a" },
      { type: "same", text: "b" },
      { type: "same", text: "c" },
    ]);
  });

  it("detects a single line changed in the middle", () => {
    const r = diffLines("a\nb\nc", "a\nB\nc");
    expect(r).toEqual([
      { type: "same", text: "a" },
      { type: "del", text: "b" },
      { type: "add", text: "B" },
      { type: "same", text: "c" },
    ]);
  });

  it("detects an added line", () => {
    const r = diffLines("a\nc", "a\nb\nc");
    expect(r).toEqual([
      { type: "same", text: "a" },
      { type: "add", text: "b" },
      { type: "same", text: "c" },
    ]);
  });

  it("detects a removed line", () => {
    const r = diffLines("a\nb\nc", "a\nc");
    expect(r).toEqual([
      { type: "same", text: "a" },
      { type: "del", text: "b" },
      { type: "same", text: "c" },
    ]);
  });

  it("handles empty inputs", () => {
    expect(diffLines("", "")).toEqual([{ type: "same", text: "" }]);
  });

  it("handles completely disjoint content", () => {
    const r = diffLines("x", "y");
    expect(r).toEqual([
      { type: "del", text: "x" },
      { type: "add", text: "y" },
    ]);
  });
});
