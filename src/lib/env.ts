// The ONLY file allowed to read process.env (guard: no-raw-env).
// Fail-fast on boot if required vars are missing/invalid.
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

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

  QUEUE_CONCURRENCY_TEXT: z.coerce.number().int().positive().default(8),
  QUEUE_CONCURRENCY_IMAGE: z.coerce.number().int().positive().default(10),
  QUEUE_CONCURRENCY_VIDEO: z.coerce.number().int().positive().default(4),
  QUEUE_CONCURRENCY_VOICE: z.coerce.number().int().positive().default(8),
  WATCHDOG_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  TASK_HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),

  // Quotas — per-user concurrent slots (distributed semaphore) + daily API caps.
  QUOTA_USER_CONCURRENT_IMAGE: z.coerce.number().int().positive().default(4),
  QUOTA_USER_CONCURRENT_VIDEO: z.coerce.number().int().positive().default(2),
  QUOTA_DAILY_IMAGE: z.coerce.number().int().positive().default(200),
  QUOTA_DAILY_VIDEO: z.coerce.number().int().positive().default(50),

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

// Fail closed: the dev-only encryption/auth secrets must never reach production.
const DEV_ONLY_SECRETS = new Set(["dev-only-encryption-key-change-me", "dev-only-change-me"]);
if (parsed.data.NODE_ENV === "production") {
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
