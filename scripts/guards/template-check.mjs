// Guard: standards/templates/*.json must be structurally valid declarative
// media templates (docs/tech/03-provider-layer.md §M2).
// Why: a malformed template fails at generation time in production otherwise.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { report } from "./lib.mjs";

const DIR = "standards/templates";
const ALLOWED_VARS = new Set([
  "model", "prompt", "negative_prompt", "image_url", "duration",
  "aspect_ratio", "text", "voice_id", "task_id",
]);
const ALLOWED_KEY_REFS = new Set(["openrouter", "fal", "atlascloud", "fake"]);

const hits = [];
if (existsSync(DIR)) {
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".json"))) {
    const path = join(DIR, f);
    let t;
    try {
      t = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      hits.push(`${path}  invalid JSON: ${e.message}`);
      continue;
    }
    if (!t.id) hits.push(`${path}  missing id`);
    if (!["image", "video", "tts"].includes(t.apiType)) hits.push(`${path}  bad apiType`);
    if (!ALLOWED_KEY_REFS.has(t.apiKeyRef)) hits.push(`${path}  bad apiKeyRef: ${t.apiKeyRef}`);
    if (!t.create?.url) hits.push(`${path}  missing create.url`);
    const isAsync = Boolean(t.createExtract?.taskId);
    if (isAsync && (!t.status || !t.statusExtract || !t.states?.done?.length)) {
      hits.push(`${path}  async template missing status/statusExtract/states.done`);
    }
    if (!isAsync && !t.createExtract?.resultUrl) {
      hits.push(`${path}  sync template missing createExtract.resultUrl`);
    }
    const raw = JSON.stringify(t);
    for (const m of raw.matchAll(/\{\{(\w+)\}\}/g)) {
      if (!ALLOWED_VARS.has(m[1])) hits.push(`${path}  unknown placeholder {{${m[1]}}}`);
    }
  }
}
process.exit(report("template-check", hits) ? 0 : 1);
