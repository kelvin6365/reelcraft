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
        return JSON.parse(repairTruncatedJson(escaped));
      } catch (err) {
        throw new JsonParseError(`output is not valid JSON: ${String(err)}`, raw);
      }
    }
  }
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
