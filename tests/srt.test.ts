import { describe, expect, it } from "vitest";
import { parseSrt } from "@/lib/srt";
import { TaskError } from "@/lib/task/types";

describe("parseSrt", () => {
  it("parses a basic multi-cue file", () => {
    const cues = parseSrt("1\n00:00:01,000 --> 00:00:04,000\nHello\n\n2\n00:00:05,000 --> 00:00:07,500\nWorld");
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ index: 1, startMs: 1000, endMs: 4000, text: "Hello" });
    expect(cues[1]).toMatchObject({ index: 2, startMs: 5000, endMs: 7500, text: "World" });
  });

  it("tolerates BOM, CRLF and joins multi-line cue text", () => {
    const cues = parseSrt("﻿1\r\n00:00:00,000 --> 00:00:02,000\r\nline one\r\nline two\r\n");
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe("line one\nline two");
  });

  it("re-numbers cues and tolerates missing indices", () => {
    const cues = parseSrt("00:00:00,000 --> 00:00:01,000\nA\n\n00:00:01,000 --> 00:00:02,000\nB");
    expect(cues.map((c) => c.index)).toEqual([1, 2]);
  });

  it("accepts '.' millisecond separator and skips empty-text blocks", () => {
    const cues = parseSrt("1\n00:00:01.500 --> 00:00:02.000\n\n\n2\n00:00:02.000 --> 00:00:03.000\nkept");
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe("kept");
  });

  it("throws terminal BAD_SRT when nothing parses", () => {
    try {
      parseSrt("this is not a subtitle file at all");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TaskError);
      expect((err as TaskError).code).toBe("BAD_SRT");
      expect((err as TaskError).retryable).toBe(false);
    }
  });
});
