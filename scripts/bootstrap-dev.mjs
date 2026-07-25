#!/usr/bin/env node
// dev bootstrap: gets a fresh checkout to a runnable `npm run dev` state.
// Steps: .env scaffold -> mode resolution (auto-detect + write-back) -> mode
// branch (full: infra checks + migrate; local: SQLite db push) -> model key
// fallback -> Prisma client regenerate-on-switch. See
// docs/plans/2026-07-25-local-quickstart-design.md (§1, §4) for the full design.
// Invoked by scripts/dev.mjs (not npm's predev — see package.json).
import { existsSync, copyFileSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { connect } from "node:net";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ENV_PATH = ".env";
const ENV_EXAMPLE_PATH = ".env.example";
const SQLITE_CLIENT_SCHEMA = "node_modules/.prisma/client/schema.prisma";

function ok(msg) {
  console.log(`✔ ${msg}`);
}
function info(msg) {
  console.log(`ℹ ${msg}`);
}
function fail(msg) {
  console.error(`✖ ${msg}`);
}

// Step 1: scaffold .env from .env.example if missing.
function ensureEnvFile() {
  if (existsSync(ENV_PATH)) return;
  copyFileSync(ENV_EXAMPLE_PATH, ENV_PATH);
  ok(".env 唔存在 — 已由 .env.example 建立");
}

// Simple line parser — no dotenv dependency. Good enough for KEY=VALUE lines;
// does not handle quoting/escaping edge cases (not needed for our .env files).
function parseEnv(path) {
  const out = {};
  const lines = readFileSync(path, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

// TCP reachability probe with a timeout — used for both Postgres and Redis.
function checkTcp(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: timeoutMs });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function parseHostPort(url, fallbackPort) {
  try {
    const u = new URL(url);
    return { host: u.hostname, port: Number(u.port) || fallbackPort };
  } catch {
    return null;
  }
}

// Mode resolution: DEPLOY_MODE explicit in .env always wins (never silently
// switch modes under a user — that's how SQLite data goes "missing"). Unset ->
// probe Postgres reachability and decide, then write the decision back into
// .env so it's pinned for next time.
async function resolveMode(env) {
  if (env.DEPLOY_MODE === "full" || env.DEPLOY_MODE === "local") {
    ok(`DEPLOY_MODE=${env.DEPLOY_MODE}`);
    return env.DEPLOY_MODE;
  }

  const dbTarget = env.DATABASE_URL ? parseHostPort(env.DATABASE_URL, 5432) : null;
  const reachable = dbTarget ? await checkTcp(dbTarget.host, dbTarget.port) : false;
  const mode = reachable ? "full" : "local";

  appendFileSync(ENV_PATH, `\nDEPLOY_MODE=${mode}\n`);
  if (mode === "local") {
    ok("偵測唔到 Postgres — 用 local 模式（SQLite＋本機檔案，零 Docker）。想用完整版：設 DEPLOY_MODE=full 並 docker compose up -d");
  } else {
    ok("偵測到 Postgres — 用 full 模式");
  }
  return mode;
}

async function checkFullModeInfra(env) {
  let allOk = true;

  const dbTarget = env.DATABASE_URL ? parseHostPort(env.DATABASE_URL, 5432) : null;
  if (!dbTarget) {
    fail("DATABASE_URL 未設定或格式不正確");
    allOk = false;
  } else {
    const reachable = await checkTcp(dbTarget.host, dbTarget.port);
    if (reachable) {
      ok(`Postgres 可連線（${dbTarget.host}:${dbTarget.port}）`);
    } else {
      fail(`連唔到 Postgres（${dbTarget.host}:${dbTarget.port}）— 行咗 docker compose up -d 未？`);
      allOk = false;
    }
  }

  const redisUrl = env.REDIS_URL || "redis://localhost:6379";
  const redisTarget = parseHostPort(redisUrl, 6379);
  if (!redisTarget) {
    fail("REDIS_URL 格式不正確");
    allOk = false;
  } else {
    const reachable = await checkTcp(redisTarget.host, redisTarget.port);
    if (reachable) {
      ok(`Redis 可連線（${redisTarget.host}:${redisTarget.port}）`);
    } else {
      fail(`連唔到 Redis（${redisTarget.host}:${redisTarget.port}）— 行咗 docker compose up -d 未？`);
      allOk = false;
    }
  }

  return allOk;
}

// Step: no provider key + no explicit preset -> force the fake preset so
// dev works with zero external accounts.
function ensureModelPreset(env) {
  const hasProviderKey = ["OPENROUTER_API_KEY", "FAL_KEY", "ATLASCLOUD_API_KEY"].some(
    (k) => (env[k] ?? "").trim() !== ""
  );
  const presetSet = (env.MODEL_DEFAULTS_PRESET ?? "").trim() !== "";
  if (hasProviderKey || presetSet) return;
  appendFileSync(ENV_PATH, "\nMODEL_DEFAULTS_PRESET=fake\n");
  ok("冇 provider key — 已設 MODEL_DEFAULTS_PRESET=fake（fake 模型走全程，唔使錢）");
}

// Which provider the currently-generated @prisma/client was built against, or
// null if no client has been generated yet. Used to force a regenerate when
// a `npm run dev` mode switch would otherwise leave a stale client behind.
function generatedClientProvider() {
  if (!existsSync(SQLITE_CLIENT_SCHEMA)) return null;
  const content = readFileSync(SQLITE_CLIENT_SCHEMA, "utf8");
  return content.includes('provider = "sqlite"') ? "sqlite" : "postgresql";
}

// full-mode branch: apply pending committed migrations, non-interactively.
// `migrate deploy` (not `migrate dev`) is correct here — it never prompts and
// never creates new migrations, just applies what's already committed.
function ensureMigrations() {
  try {
    execSync("npx prisma migrate deploy --schema prisma/schema.prisma", {
      stdio: "inherit",
    });
    ok("Prisma migrations 已套用");
  } catch (err) {
    fail("Prisma migrate deploy 失敗");
    throw err;
  }

  if (generatedClientProvider() !== "postgresql") {
    try {
      execSync("npx prisma generate --schema prisma/schema.prisma", { stdio: "inherit" });
      ok("Prisma client 已生成（postgresql）");
    } catch (err) {
      fail("Prisma generate 失敗");
      throw err;
    }
  }
}

// .env files created before SQLITE_URL existed won't have it — same pattern as
// ensureModelPreset. Without this, `prisma db push --schema schema.sqlite.prisma`
// fails with "Environment variable not found: SQLITE_URL" instead of running.
function ensureSqliteUrlVar(env) {
  if ((env.SQLITE_URL ?? "").trim() !== "") return;
  appendFileSync(ENV_PATH, '\nSQLITE_URL="file:../data/local.db"\n');
  ok(".env 缺 SQLITE_URL — 已補上預設值（data/local.db）");
}

// local-mode branch: mkdir data/, then `db push` + `generate` against the
// SQLite schema. Two explicit steps (not `db push` alone) so generate always
// targets the sqlite schema in local mode, even if the client was last built
// for postgres. Never passes --accept-data-loss — a destructive schema change
// against the user's real local.db must stop and ask, not silently wipe data.
function ensureSqliteDb(env) {
  ensureSqliteUrlVar(env);

  if (!existsSync("data")) {
    mkdirSync("data");
    ok("data/ 已建立");
  }

  try {
    execSync("npx prisma db push --schema prisma/schema.sqlite.prisma --skip-generate", {
      stdio: "inherit",
    });
    ok("SQLite db 已同步（prisma db push）");
  } catch {
    fail("schema 變更需要重置本機資料庫 — 想繼續：rm -rf data/local.db 再 npm run dev");
    throw new Error("sqlite db push refused (would need --accept-data-loss)");
  }

  if (generatedClientProvider() !== "sqlite") {
    try {
      execSync("npx prisma generate --schema prisma/schema.sqlite.prisma", { stdio: "inherit" });
      ok("Prisma client 已生成（sqlite）");
    } catch (err) {
      fail("Prisma generate 失敗");
      throw err;
    }
  }
}

export async function main() {
  ensureEnvFile();

  let env = parseEnv(ENV_PATH);
  const mode = await resolveMode(env);
  // resolveMode may have appended DEPLOY_MODE to .env — re-read so downstream
  // steps see the final state.
  env = parseEnv(ENV_PATH);

  if (mode === "full") {
    const infraOk = await checkFullModeInfra(env);
    if (!infraOk) {
      process.exit(1);
    }
  }

  ensureModelPreset(env);

  try {
    if (mode === "local") {
      ensureSqliteDb(env);
    } else {
      ensureMigrations();
    }
  } catch {
    process.exit(1);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
