// The ONLY file allowed to read process.env (guard: no-raw-env).
// Fail-fast on boot if required vars are missing/invalid.
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // "full" = Postgres+Redis+BullMQ (default, unchanged behavior). "local" = SQLite
  // + in-process substitutes for every Redis dependency (docs/plans/2026-07-25-
  // local-quickstart-design.md) — a single `npm run dev`, zero Docker. Every local
  // branch is additive: this flag must never change full-mode behavior.
  DEPLOY_MODE: z.enum(["full", "local"]).default("full"),

  STORAGE_TYPE: z.enum(["local", "s3"]).default("local"),
  STORAGE_ENDPOINT: z.string().url(),
  STORAGE_ACCESS_KEY: z.string().min(1),
  STORAGE_SECRET_KEY: z.string().min(1),
  STORAGE_BUCKET: z.string().min(1),

  BETTER_AUTH_SECRET: z.string().min(8),
  BETTER_AUTH_URL: z.string().url(),

  // BYO-Key envelope master key. A default here would encrypt every tenant's
  // provider key under a repo-public constant — so there is no default, and the
  // dev-only literal is rejected outside development (see refine below).
  API_ENCRYPTION_KEY: z.string().min(16),

  OPENROUTER_API_KEY: z.string().optional().default(""),
  FAL_KEY: z.string().optional().default(""),
  ATLASCLOUD_API_KEY: z.string().optional().default(""),

  // Explicit dev/CI override: when "fake", the SYSTEM layer of model-defaults
  // resolution becomes fake::* so smoke scripts / keyless dev never call a real
  // provider. This is a declared configuration, NOT a silent downgrade
  // (CLAUDE.md #3) — real deployments leave it empty. Only "fake" is meaningful;
  // any other value (including empty) keeps the real system defaults in place.
  MODEL_DEFAULTS_PRESET: z.string().optional().default(""),

  QUEUE_CONCURRENCY_TEXT: z.coerce.number().int().positive().default(8),
  QUEUE_CONCURRENCY_IMAGE: z.coerce.number().int().positive().default(10),
  QUEUE_CONCURRENCY_VIDEO: z.coerce.number().int().positive().default(4),
  QUEUE_CONCURRENCY_VOICE: z.coerce.number().int().positive().default(8),
  WATCHDOG_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  TASK_HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  // Hard per-task runtime cap enforced in withTaskLifecycle. Catches the case the
  // watchdog can't see: handler hung on a never-resolving await while heartbeats
  // keep beating. Must exceed the slowest legitimate task (adapter poll caps at 10min).
  TASK_MAX_RUNTIME_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),

  // Quotas — per-user concurrent slots (distributed semaphore) + daily API caps.
  QUOTA_USER_CONCURRENT_IMAGE: z.coerce.number().int().positive().default(4),
  QUOTA_USER_CONCURRENT_VIDEO: z.coerce.number().int().positive().default(2),
  QUOTA_DAILY_IMAGE: z.coerce.number().int().positive().default(200),
  QUOTA_DAILY_VIDEO: z.coerce.number().int().positive().default(50),

  // API rate limit (per user, sliding window). Reads (GET) are generous — a
  // single workspace page-load fans out many of them; writes are tighter (and
  // also gated by quota + billing). Raise if legit navigation still trips 429.
  RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_READ_MAX: z.coerce.number().int().positive().default(600),
  RATE_LIMIT_WRITE_MAX: z.coerce.number().int().positive().default(120),

  BILLING_MODE: z.enum(["OFF", "SHADOW", "ENFORCE"]).default("SHADOW"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`[env] invalid environment:\n${issues}`);
}

// Fail closed: the dev-only encryption/auth secrets must never reach production —
// but only at RUNTIME, not during `next build` (which forces NODE_ENV=production
// before real secrets are injected). NEXT_PHASE marks the build phase.
const DEV_ONLY_SECRETS = new Set(["dev-only-encryption-key-change-me", "dev-only-change-me"]);
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
if (parsed.data.NODE_ENV === "production" && !isBuildPhase) {
  if (DEV_ONLY_SECRETS.has(parsed.data.API_ENCRYPTION_KEY)) {
    throw new Error("[env] API_ENCRYPTION_KEY is still the dev placeholder — set a real secret in production");
  }
  if (DEV_ONLY_SECRETS.has(parsed.data.BETTER_AUTH_SECRET)) {
    throw new Error("[env] BETTER_AUTH_SECRET is still the dev placeholder — set a real secret in production");
  }
  // Local storage serves permanent unauthenticated /api/files URLs — prod must use
  // S3/R2 signed URLs (CLAUDE.md #4). Enforce the invariant both audits called out.
  if (parsed.data.STORAGE_TYPE === "local") {
    throw new Error("[env] STORAGE_TYPE=local is dev-only — use s3 in production");
  }
}

export const env = parsed.data;
export type Env = typeof env;

export function isLocalMode(): boolean {
  return env.DEPLOY_MODE === "local";
}
