#!/usr/bin/env node
// DEPLOY_MODE=local variant of `npm run smoke:pipeline` — proves the SQLite +
// embedded-worker path end-to-end (novel -> mp4, fake providers, zero cost).
// docs/plans/2026-07-25-local-quickstart-design.md §4.
//
// Uses a THROWAWAY sqlite db (prisma/smoke-local.db, gitignored) — never the
// user's real data/local.db — via a dedicated SQLITE_URL override. db push
// creates/syncs it first (--accept-data-loss is safe here: the db is disposable
// and recreated every run), then the smoke script runs with the same env so
// its Prisma client resolves the same file.
import { execFileSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";

const SMOKE_SQLITE_URL = "file:./smoke-local.db";
const SMOKE_ENV = {
  ...process.env,
  DEPLOY_MODE: "local",
  SQLITE_URL: SMOKE_SQLITE_URL,
  MODEL_DEFAULTS_PRESET: "fake",
};

function cleanup() {
  rmSync("prisma/smoke-local.db", { force: true });
  rmSync("prisma/smoke-local.db-journal", { force: true });
}

cleanup(); // stale leftovers from a previous killed run
console.log("[smoke:local] syncing throwaway sqlite db…");
execFileSync("npx", ["prisma", "db", "push", "--schema", "prisma/schema.sqlite.prisma", "--skip-generate", "--accept-data-loss"], {
  stdio: "inherit",
  env: SMOKE_ENV,
});
// Self-contained: don't assume a prior `npm run dev` in local mode already
// generated the sqlite @prisma/client — generate it here too. Side effect:
// leaves the repo's generated client on the sqlite schema, same as running
// local-mode dev would; regenerate against schema.prisma to go back to postgres.
console.log("[smoke:local] generating sqlite prisma client…");
execFileSync("npx", ["prisma", "generate", "--schema", "prisma/schema.sqlite.prisma"], {
  stdio: "inherit",
  env: SMOKE_ENV,
});

const child = spawn("npx", ["tsx", "--env-file=.env", "scripts/smoke-pipeline.ts"], {
  stdio: "inherit",
  env: SMOKE_ENV,
});

child.on("exit", (code, signal) => {
  cleanup();
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
