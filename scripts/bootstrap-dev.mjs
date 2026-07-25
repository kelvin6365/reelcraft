#!/usr/bin/env node
// predev bootstrap: gets a fresh checkout to a runnable `npm run dev` state.
// Steps: .env scaffold -> mode resolution -> infra reachability -> model key
// fallback -> migration status. See docs/plans/2026-07-25-local-quickstart-design.md
// (§1, §4) for the full design; this script implements PR-A's skeleton only
// (no SQLite / in-process worker yet — those land in PR-B..D).
import { existsSync, copyFileSync, readFileSync, appendFileSync } from "node:fs";
import { connect } from "node:net";
import { execSync } from "node:child_process";

const ENV_PATH = ".env";
const ENV_EXAMPLE_PATH = ".env.example";

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

// Mode resolution. PR-A does not auto-detect — that lands in PR-D once SQLite
// (PR-B) and the in-process Redis substitutes (PR-C) exist to fall back to.
// TODO(PR-D): probe DATABASE_URL reachability and pick "local" when Postgres
// is unreachable and DEPLOY_MODE is unset (docs/plans/2026-07-25-local-quickstart-design.md §1).
function detectMode(env) {
  if (env.DEPLOY_MODE === "full" || env.DEPLOY_MODE === "local") {
    return env.DEPLOY_MODE;
  }
  return "full";
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

// Step 4: no provider key + no explicit preset -> force the fake preset so
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

// Step 5: apply pending committed migrations, non-interactively. `migrate
// deploy` (not `migrate dev`) is correct here — it never prompts and never
// creates new migrations, just applies what's already committed.
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

  if (!existsSync("node_modules/.prisma/client")) {
    try {
      execSync("npx prisma generate --schema prisma/schema.prisma", { stdio: "inherit" });
      ok("Prisma client 已生成");
    } catch (err) {
      fail("Prisma generate 失敗");
      throw err;
    }
  }
}

async function main() {
  ensureEnvFile();

  const env = parseEnv(ENV_PATH);
  const mode = detectMode(env);
  if (env.DEPLOY_MODE === "full" || env.DEPLOY_MODE === "local") {
    ok(`DEPLOY_MODE=${mode}`);
  } else {
    info("DEPLOY_MODE 未設定 — 暫時當 full（local 模式 SQLite 支援喺後續 PR）");
  }

  if (mode === "full") {
    const infraOk = await checkFullModeInfra(env);
    if (!infraOk) {
      process.exit(1);
    }
  }

  // Re-read after ensureModelPreset may have appended to .env.
  ensureModelPreset(env);

  try {
    ensureMigrations();
  } catch {
    process.exit(1);
  }
}

main();
