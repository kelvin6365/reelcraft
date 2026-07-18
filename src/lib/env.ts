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

  // BYO-Key envelope encryption. Falling back to BETTER_AUTH_SECRET couples two
  // trust boundaries (waoowaoo lesson) — so this is REQUIRED, no fallback.
  API_ENCRYPTION_KEY: z.string().min(16).default("dev-only-encryption-key-change-me"),

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

export const env = parsed.data;
export type Env = typeof env;
