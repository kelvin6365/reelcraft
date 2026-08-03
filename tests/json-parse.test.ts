// safeParseJson is the last line of defence when a model emits not-quite-JSON.
// json_object mode (openrouter) prevents most of it now, but truncation and
// trailing commas still slip through — these lock in the repair fallbacks.
import { describe, expect, it } from "vitest";
import { safeParseJson } from "@/lib/prompts/parse";

describe("safeParseJson", () => {
  it("parses clean JSON", () => {
    expect(safeParseJson('{"a":1,"b":[1,2,3]}')).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("strips a ```json fence and surrounding prose", () => {
    expect(safeParseJson('好的，這是結果：\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("escapes raw newlines inside string values", () => {
    expect(safeParseJson('{"note":"line one\nline two"}')).toEqual({ note: "line one\\nline two".replace("\\n", "\n") });
  });

  it("removes trailing commas before a closer", () => {
    expect(safeParseJson('{"shots":[{"i":1},{"i":2},]}')).toEqual({ shots: [{ i: 1 }, { i: 2 }] });
  });

  // The reported failure: a storyboard array cut off by max_tokens mid-element.
  it("closes a truncated array (max_tokens hit mid-response)", () => {
    const truncated = '{"shots":[{"index":1,"subject":"a"},{"index":2,"subject":"b"';
    const out = safeParseJson(truncated) as { shots: { index: number }[] };
    expect(out.shots[0].index).toBe(1);
    expect(out.shots.length).toBeGreaterThanOrEqual(1);
  });

  it("closes a truncated string then its containers", () => {
    const truncated = '{"shots":[{"index":1,"subject":"an unterminated str';
    const out = safeParseJson(truncated) as { shots: { index: number }[] };
    expect(out.shots[0].index).toBe(1);
  });

  it("does not miscount brackets that appear inside string values", () => {
    expect(safeParseJson('{"text":"a [bracket] and {brace} inside","n":1}')).toEqual({
      text: "a [bracket] and {brace} inside",
      n: 1,
    });
  });

  it("throws JsonParseError on unrepairable garbage", () => {
    expect(() => safeParseJson("this is not json at all")).toThrow();
  });
});

// 實測（2026-08-03）：extract_props 收到 `{"props": [` —— 11 個字元一開頭就斷。
// repairTruncatedJson 補成 `{"props": []}`，parse 過、zod 過（props 有預設空陣列），
// 道具抽取靜靜地回零個道具，同「呢場戲真係冇道具」分唔開。修補只可以救返一部分，
// 唔可以無中生有一個空答案。
describe("truncated-to-empty repair", () => {
  it("拒絕把一開頭就斷嘅輸出救成空結果", () => {
    expect(() => safeParseJson('{"props": [')).toThrow(/truncated to an empty payload/);
  });

  it("全部子值都空嘅殼一樣拒絕", () => {
    expect(() => safeParseJson('{"characters": [], "locations": [')).toThrow(/truncated to an empty payload/);
  });

  it("救返有內容嘅部分結果照樣放行", () => {
    const out = safeParseJson('{"props": [{"name": "長劍"}, {"name": "法') as { props: { name: string }[] };
    expect(out.props.length).toBeGreaterThanOrEqual(1);
    expect(out.props[0].name).toBe("長劍");
  });

  // 真正嘅空結果（呢場戲真係冇道具）第一次 JSON.parse 就過，永遠行唔到修補路徑。
  it("合法嘅空結果唔受影響", () => {
    expect(safeParseJson('{"props": []}')).toEqual({ props: [] });
  });
});
