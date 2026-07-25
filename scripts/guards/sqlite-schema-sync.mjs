// Guard: prisma/schema.sqlite.prisma must be the exact output of transforming
// prisma/schema.prisma (docs/plans/2026-07-25-local-quickstart-design.md §2, CLAUDE.md #8).
// Why: the generated schema is checked in for reproducible local-mode `prisma
// generate` — a hand-edit or a stale regenerate would silently desync it from
// the postgres source of truth.
import { readFileSync } from "node:fs";
import { transformSchema } from "../lib-sqlite-transform.mjs";
import { report } from "./lib.mjs";

const SOURCE = "prisma/schema.prisma";
const TARGET = "prisma/schema.sqlite.prisma";

const hits = [];
const src = readFileSync(SOURCE, "utf8");
const expected = transformSchema(src);
const actual = readFileSync(TARGET, "utf8");

if (expected !== actual) {
  hits.push("schema.sqlite.prisma 同 schema.prisma 唔同步 — 跑 node scripts/gen-sqlite-schema.mjs");
}

process.exit(report("sqlite-schema-sync", hits) ? 0 : 1);
