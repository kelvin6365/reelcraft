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
  } catch (err) {
    throw new JsonParseError(`output is not valid JSON: ${String(err)}`, raw);
  }
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
