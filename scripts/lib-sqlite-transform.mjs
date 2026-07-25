// Pure transform: postgres schema.prisma source -> sqlite schema.prisma source.
// Shared by scripts/gen-sqlite-schema.mjs and scripts/guards/sqlite-schema-sync.mjs
// so the guard re-runs the exact same logic the generator used (docs/plans/2026-07-25-local-quickstart-design.md §2).
export const HEADER =
  "// AUTO-GENERATED from schema.prisma by scripts/gen-sqlite-schema.mjs — DO NOT EDIT.\n" +
  "// Regenerate: node scripts/gen-sqlite-schema.mjs\n\n";

const DATASOURCE_RE = /datasource\s+db\s*\{[^}]*\}/;
// env("SQLITE_URL"), not env("DATABASE_URL") — DATABASE_URL is a postgres://
// URL shared with the postgres schema, and `prisma validate` rejects a sqlite
// provider whose resolved url doesn't start with `file:`. A dedicated var lets
// both schemas' env() lookups coexist in one .env without clashing.
// .env.example defaults SQLITE_URL to "file:../data/local.db" (relative to
// prisma/, so it resolves to data/local.db at repo root) — smoke tests and
// PR-D bootstrap rely on that default; override SQLITE_URL to point elsewhere
// (e.g. a throwaway smoke db).
const SQLITE_DATASOURCE = 'datasource db {\n  provider = "sqlite"\n  url      = env("SQLITE_URL")\n}';

// Matches `@db.Decimal(18, 6)`, `@db.Text`, etc — native postgres type annotations
// that SQLite doesn't understand (16 occurrences as of this writing).
const DB_NATIVE_TYPE_RE = /\s*@db\.\w+(\([^)]*\))?/g;

// `Json @default("{}")` / `@default("[]")` — Prisma's postgres connector
// quotes these correctly (DEFAULT '{}'::jsonb), but its sqlite connector
// emits the literal unquoted (`DEFAULT {}`), which `prisma db push` then
// rejects as invalid SQL ("unrecognized token: {"). Route the same literal
// through dbgenerated() instead, which renders as a plain quoted SQL default
// SQLite accepts; the JSON value stored is identical either way.
const JSON_DEFAULT_RE = /@default\("(\{\}|\[\])"\)/g;

// `BigInt @id @default(autoincrement())` — SQLite only wires up its rowid
// autoincrement alias (`INTEGER PRIMARY KEY AUTOINCREMENT`) when the column's
// declared type is exactly `INTEGER`; Prisma's sqlite connector maps BigInt to
// `BIGINT` instead, which silently drops both the primary-key rowid alias and
// the default, so every insert fails with a NOT NULL violation on `id`.
// Mapping these 4 PK fields to Prisma's Int (32-bit) sidesteps it — plenty of
// headroom for a single-user local db — while leaving every other BigInt
// column (e.g. MediaObject.sizeBytes) untouched. App code that filters on
// these ids must accept `number` (not call `BigInt(...)`) so it type-checks
// against both this schema's Int and postgres's BigInt id (see
// src/app/api/sse/route.ts).
const BIGINT_AUTOINCREMENT_ID_RE = /(\bid\s+)BigInt(\s+@id\s+@default\(autoincrement\(\)\))/g;

export function transformSchema(src) {
  if (!DATASOURCE_RE.test(src)) {
    throw new Error("transformSchema: no datasource block found in source schema");
  }
  const withDatasource = src.replace(DATASOURCE_RE, SQLITE_DATASOURCE);
  const withoutNativeTypes = withDatasource.replace(DB_NATIVE_TYPE_RE, "");
  const withSqliteJsonDefaults = withoutNativeTypes.replace(
    JSON_DEFAULT_RE,
    (_match, literal) => `@default(dbgenerated("'${literal}'"))`
  );
  const withIntIds = withSqliteJsonDefaults.replace(BIGINT_AUTOINCREMENT_ID_RE, "$1Int$2");
  return HEADER + withIntIds;
}
