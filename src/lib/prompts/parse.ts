// Robust JSON extraction for LLM pipeline outputs (docs/tech/06-prompts.md).
// Prompts are told to emit pure JSON and to wrap inner quotes as 「」 so real
// double-quotes never break the JSON. A parse failure is retryable (the caller
// re-prompts with a "last output was not valid JSON" hint); terminal after 2.
import type { z } from "zod";

export class JsonParseError extends Error {
  constructor(
    message: string,
    public raw: string,
  ) {
    super(message);
    this.name = "JsonParseError";
  }
}

/**
 * Strip markdown fences and any prose around the JSON body, then JSON.parse.
 * CJK corner brackets 「」 are valid inside JSON string values, so they are left
 * intact by default — restoreCjkQuotes() is offered for callers that want plain
 * quotes back in the parsed leaves.
 */
export function safeParseJson(raw: string): unknown {
  const body = extractJsonBody(raw);
  try {
    return JSON.parse(body);
  } catch {
    // Deterministic repair for the most common LLM breakage: raw control
    // characters (newline/tab) inside string values — JSON.parse reports
    // "Unterminated string". Escape them only INSIDE strings, then re-parse.
    const escaped = escapeControlCharsInStrings(body);
    try {
      return JSON.parse(escaped);
    } catch {
      // Last resort (the experimental_repairText idea): strip trailing commas and
      // close a truncated tail (the model hit max_tokens mid-array/object). Better
      // a slightly-shorter valid structure than failing the whole storyboard.
      try {
        const repaired = repairTruncatedJson(escaped);
        const value = JSON.parse(repaired);
        // 修補只可以「救返一部分」，唔可以「無中生有一個空答案」。
        //
        // 實測：extract_props 收到嘅 raw 係 `{"props": [` —— 11 個字元，一開頭就斷。
        // repairTruncatedJson 照樣補成 `{"props": []}`，parse 得過、zod 又過（props 有
        // 預設空陣列），於是道具抽取靜靜地回咗零個道具，同「呢場戲真係冇道具」完全
        // 分唔開。呢個唔係救援，係捏造。
        //
        // 判斷用「救返嘅內容係咪完全空」而唔係用字數地板：字數地板綁死語言（中文比
        // 英文密好多），而且真正嘅分界線本來就係語意——救到嘢就有價值，救唔到就唔應該
        // 扮成功。合法嘅空結果（真係冇道具）第一次 JSON.parse 就會過，永遠行唔到呢度。
        if (isEmptyPayload(value)) {
          throw new JsonParseError(
            `output was truncated to an empty payload — refusing to pass it off as a real result (raw=${raw.length} chars, tail=${JSON.stringify(raw.slice(-120))})`,
            raw,
          );
        }
        // Reaching here means the model's output was cut mid-structure and we
        // silently closed it. The result parses, but is missing however much the
        // model never emitted — so it must leave a trace (this fallback used to
        // be completely invisible; whole storyboard passes went missing with
        // zero log). The adapter now rejects finish_reason=length upstream, so
        // anything landing here is a truncation the provider did not report.
        console.warn(
          `[json-repair] repaired an unparseable LLM JSON output (truncated tail and/or dangling comma): raw=${raw.length} chars, repaired=${repaired.length} chars, tail=${JSON.stringify(raw.slice(-120))}`,
        );
        return value;
      } catch (err) {
        // 空救援嘅判斷已經帶住自己嘅訊息，唔好再包一層「not valid JSON」——佢本來就 parse 到。
        if (err instanceof JsonParseError) throw err;
        throw new JsonParseError(`output is not valid JSON: ${String(err)}`, raw);
      }
    }
  }
}

// 「救返嘅嘢係咪完全空」——空物件／空陣列／空字串，以及全部子值都空嘅物件陣列，
// 一律當空。用嚟分辨「補完之後仲有內容」同「補完之後淨返個殼」。
function isEmptyPayload(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (typeof value === "number" || typeof value === "boolean") return false;
  if (Array.isArray(value)) return value.every(isEmptyPayload);
  return Object.values(value as Record<string, unknown>).every(isEmptyPayload);
}

// Strip trailing commas, then balance any brackets/quote left open by a
// truncated response — walking the text in string-context so brackets inside
// strings aren't counted. Returns text JSON.parse can accept when the only
// breakage is a missing tail.
function repairTruncatedJson(s: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  const stack: string[] = [];
  for (const ch of s) {
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
    out += ch;
  }
  if (inString) out += '"'; // close a truncated string
  // Drop a dangling trailing comma before we append closers.
  out = out.replace(/,\s*$/, "");
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === "{" ? "}" : "]";
  // Also remove trailing commas that sit right before a closer anywhere.
  return out.replace(/,(\s*[}\]])/g, "$1");
}

// Walk the JSON text tracking string context; replace literal control chars
// inside strings with their escaped forms so JSON.parse accepts them.
function escapeControlCharsInStrings(s: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of s) {
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
        out += ch;
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        out += ch === "\n" ? "\\n" : ch === "\t" ? "\\t" : ch === "\r" ? "" : " ";
        continue;
      }
      out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

/** safeParseJson + zod validation in one step. */
export function parseWithSchema<T>(raw: string, schema: z.ZodType<T>): T {
  return schema.parse(safeParseJson(raw));
}

function extractJsonBody(raw: string): string {
  let s = raw.trim();

  // Strip a fenced block ```json ... ``` (or bare ``` ... ```), keeping its body.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();

  // Otherwise slice from the first opening bracket to its matching last one,
  // dropping any leading/trailing prose the model may have added.
  const firstObj = s.indexOf("{");
  const firstArr = s.indexOf("[");
  const start =
    firstArr === -1 ? firstObj : firstObj === -1 ? firstArr : Math.min(firstObj, firstArr);
  if (start > 0) {
    const openCh = s[start];
    const closeCh = openCh === "{" ? "}" : "]";
    const end = s.lastIndexOf(closeCh);
    if (end > start) s = s.slice(start, end + 1);
  }
  return s;
}

/** Convert 「…」 corner brackets back to straight double quotes in a string. */
export function restoreCjkQuotes(value: string): string {
  return value.replace(/「/g, '"').replace(/」/g, '"');
}
