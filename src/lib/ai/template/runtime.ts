// Executes a MediaTemplate: interpolate → create → (poll status) → resultUrl.
// Only generate-media.ts may import this (guard: no-ai-bypass).
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { AiError } from "@/lib/ai/types";
import { MediaTemplate, TEMPLATE_VARS, type TemplateVar } from "@/lib/ai/template/schema";

const TEMPLATE_DIR = join(process.cwd(), "standards", "templates");

let cache: Map<string, MediaTemplate> | null = null;

export async function loadTemplates(): Promise<Map<string, MediaTemplate>> {
  if (cache) return cache;
  const map = new Map<string, MediaTemplate>();
  let files: string[] = [];
  try {
    files = (await readdir(TEMPLATE_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    /* no templates dir yet */
  }
  for (const f of files) {
    const raw = JSON.parse(await readFile(join(TEMPLATE_DIR, f), "utf8")) as unknown;
    const parsed = MediaTemplate.safeParse(raw);
    if (!parsed.success) throw new AiError("TEMPLATE_INVALID", `${f}: ${parsed.error.issues[0]?.message}`);
    validatePlaceholders(parsed.data, f);
    map.set(parsed.data.id, parsed.data);
  }
  cache = map;
  return map;
}

export function clearTemplateCache(): void {
  cache = null;
}

function collectPlaceholders(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    for (const m of value.matchAll(/\{\{(\w+)\}\}/g)) out.add(m[1]);
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectPlaceholders(v, out));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => collectPlaceholders(v, out));
  }
}

function validatePlaceholders(t: MediaTemplate, file: string): void {
  const used = new Set<string>();
  collectPlaceholders(t.create, used);
  if (t.status) collectPlaceholders(t.status, used);
  for (const v of used) {
    if (!TEMPLATE_VARS.includes(v as TemplateVar)) {
      throw new AiError("TEMPLATE_INVALID", `${file}: unknown placeholder {{${v}}}`);
    }
  }
}

export type TemplateVars = Partial<Record<TemplateVar, string>>;

function interpolate<T>(value: T, vars: TemplateVars): T {
  if (typeof value === "string") {
    return value.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k as TemplateVar] ?? "") as T;
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, vars)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v, vars)])) as T;
  }
  return value;
}

// JSONPath-lite: $.a.b[0].c — dots and numeric indexes only.
export function extractPath(obj: unknown, path: string): unknown {
  if (!path.startsWith("$")) return undefined;
  let cur: unknown = obj;
  const tokens = path.slice(1).match(/\.(\w+)|\[(\d+)\]/g) ?? [];
  for (const tok of tokens) {
    if (cur == null) return undefined;
    if (tok.startsWith(".")) cur = (cur as Record<string, unknown>)[tok.slice(1)];
    else cur = (cur as unknown[])[Number(tok.slice(1, -1))];
  }
  return cur;
}

async function call(
  t: MediaTemplate,
  spec: { method: string; url: string; body?: Record<string, unknown> },
  vars: TemplateVars,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const url = interpolate(spec.url, vars);
  const res = await fetchImpl(url, {
    method: spec.method,
    headers: {
      [t.auth.header]: `${t.auth.prefix}${apiKey}`,
      ...(spec.body ? { "Content-Type": "application/json" } : {}),
    },
    body: spec.body ? JSON.stringify(interpolate(spec.body, vars)) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status >= 500;
    throw new AiError(`TEMPLATE_HTTP_${res.status}`, `${t.id}: ${text.slice(0, 300)}`, retryable);
  }
  return res.json();
}

export interface TemplateRunResult {
  resultUrl: string;
}

export async function runTemplate(
  t: MediaTemplate,
  vars: TemplateVars,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<TemplateRunResult> {
  const created = await call(t, t.create, vars, apiKey, fetchImpl);

  // synchronous template: result directly on create response
  if (!t.createExtract.taskId) {
    const url = extractPath(created, t.createExtract.resultUrl ?? "");
    if (typeof url !== "string" || !url) throw new AiError("TEMPLATE_NO_RESULT", `${t.id}: create returned no resultUrl`, true);
    return { resultUrl: url };
  }

  const taskId = extractPath(created, t.createExtract.taskId);
  if (typeof taskId !== "string" && typeof taskId !== "number") {
    throw new AiError("TEMPLATE_NO_TASK_ID", `${t.id}: create returned no taskId`, true);
  }
  if (!t.status || !t.statusExtract || !t.states) {
    throw new AiError("TEMPLATE_INVALID", `${t.id}: async template missing status/statusExtract/states`);
  }

  const pollVars: TemplateVars = { ...vars, task_id: String(taskId) };
  const deadline = Date.now() + t.polling.timeoutMs;
  while (Date.now() < deadline) {
    const status = await call(t, t.status, pollVars, apiKey, fetchImpl);
    const state = String(extractPath(status, t.statusExtract.state) ?? "");
    if (t.states.done.includes(state)) {
      const url = extractPath(status, t.statusExtract.resultUrl);
      if (typeof url !== "string" || !url) throw new AiError("TEMPLATE_NO_RESULT", `${t.id}: done but no resultUrl`, true);
      return { resultUrl: url };
    }
    if (t.states.failed.includes(state)) {
      const err = t.statusExtract.error ? String(extractPath(status, t.statusExtract.error) ?? "") : "";
      throw new AiError("TEMPLATE_GEN_FAILED", `${t.id}: ${state} ${err}`.slice(0, 300), false);
    }
    await sleep(t.polling.intervalMs);
  }
  throw new AiError("TEMPLATE_TIMEOUT", `${t.id}: polling timed out`, true);
}
