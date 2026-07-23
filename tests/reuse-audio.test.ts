import { describe, expect, it } from "vitest";
import { matchReusableAudio } from "@/lib/voice/reuse-audio";

const line = (speaker: string, content: string, audioMediaId: string | null = null, emotion = "", emotionStrength = 0.4) => ({
  speaker,
  content,
  emotion,
  emotionStrength,
  audioMediaId,
});
const want = (speaker: string, content: string, emotion = "", emotionStrength = 0.4) => ({
  speaker,
  content,
  emotion,
  emotionStrength,
});

describe("matchReusableAudio", () => {
  it("reuses every clip when nothing changed", () => {
    const existing = [line("阿明", "你返嚟啦", "m1"), line("旁白", "夜深了", "m2")];
    expect(matchReusableAudio(existing, [want("阿明", "你返嚟啦"), want("旁白", "夜深了")])).toEqual(["m1", "m2"]);
  });

  it("drops only the clip whose text was edited", () => {
    const existing = [line("阿明", "你返嚟啦", "m1"), line("旁白", "夜深了", "m2")];
    const got = matchReusableAudio(existing, [want("阿明", "你終於返嚟啦"), want("旁白", "夜深了")]);
    expect(got).toEqual([null, "m2"]);
  });

  it("drops the clip when the same text moves to another speaker", () => {
    const existing = [line("阿明", "你返嚟啦", "m1")];
    expect(matchReusableAudio(existing, [want("小美", "你返嚟啦")])).toEqual([null]);
  });

  it("still matches when a new line is inserted at the top", () => {
    const existing = [line("阿明", "你返嚟啦", "m1"), line("旁白", "夜深了", "m2")];
    const got = matchReusableAudio(existing, [
      want("旁白", "三年之後"),
      want("阿明", "你返嚟啦"),
      want("旁白", "夜深了"),
    ]);
    expect(got).toEqual([null, "m1", "m2"]);
  });

  it("never hands the same clip to two identical lines", () => {
    const existing = [line("阿明", "點解", "m1")];
    expect(matchReusableAudio(existing, [want("阿明", "點解"), want("阿明", "點解")])).toEqual(["m1", null]);
  });

  it("pairs duplicate lines in order when both have audio", () => {
    const existing = [line("阿明", "點解", "m1"), line("阿明", "點解", "m2")];
    expect(matchReusableAudio(existing, [want("阿明", "點解"), want("阿明", "點解")])).toEqual(["m1", "m2"]);
  });

  it("ignores previous lines that never got audio", () => {
    const existing = [line("阿明", "你返嚟啦", null)];
    expect(matchReusableAudio(existing, [want("阿明", "你返嚟啦")])).toEqual([null]);
  });

  it("tolerates whitespace and width differences in the model's output", () => {
    const existing = [line("阿明", "你返嚟啦", "m1")];
    expect(matchReusableAudio(existing, [want(" 阿明 ", "你返嚟啦 ")])).toEqual(["m1"]);
  });

  it("returns all nulls on a first run", () => {
    expect(matchReusableAudio([], [want("阿明", "你返嚟啦")])).toEqual([null]);
  });

  it("does not reuse a clip when only the emotion changed", () => {
    const existing = [line("阿明", "你返嚟啦", "m1", "calm", 0.2)];
    // same speaker+content, different emotion → must re-synthesize
    expect(matchReusableAudio(existing, [want("阿明", "你返嚟啦", "angry", 0.2)])).toEqual([null]);
  });

  it("does not reuse a clip when only emotionStrength changed", () => {
    const existing = [line("阿明", "你返嚟啦", "m1", "calm", 0.2)];
    expect(matchReusableAudio(existing, [want("阿明", "你返嚟啦", "calm", 0.5)])).toEqual([null]);
  });

  it("reuses when text, speaker, emotion and strength all match", () => {
    const existing = [line("阿明", "你返嚟啦", "m1", "calm", 0.3)];
    expect(matchReusableAudio(existing, [want("阿明", "你返嚟啦", "calm", 0.3)])).toEqual(["m1"]);
  });
});
