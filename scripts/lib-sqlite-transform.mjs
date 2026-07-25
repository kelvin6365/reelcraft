// Pure transform: postgres schema.prisma source -> sqlite schema.prisma source.
// Shared by scripts/gen-sqlite-schema.mjs and scripts/guards/sqlite-schema-sync.mjs
// so the guard re-runs the exact same logic the generator used (docs/plans/2026-07-25-local-quickstart-design.md §2).
export const HEADER =
  "// AUTO-GENERATED from schema.prisma by scripts/gen-sqlite-schema.mjs — DO NOT EDIT.\n" +
  "// Regenerate: node scripts/gen-sqlite-schema.mjs\n\n";

const DATASOURCE_RE = /datasource\s+db\s*\{[^}]*\}/;
// Literal file: URL, not env("DATABASE_URL") — `prisma validate` rejects a sqlite
// provider whose url doesn't start with `file:`, and .env's DATABASE_URL is a
// postgres:// URL shared with the postgres schema. PR-D bootstrap relies on this
// exact path (data/local.db, relative to prisma/ as CWD for `prisma db push`).
const SQLITE_DATASOURCE = 'datasource db {\n  provider = "sqlite"\n  url      = "file:../data/local.db"\n}';

// Matches `@db.Decimal(18, 6)`, `@db.Text`, etc — native postgres type annotations
// that SQLite doesn't understand (16 occurrences as of this writing).
const DB_NATIVE_TYPE_RE = /\s*@db\.\w+(\([^)]*\))?/g;

export function transformSchema(src) {
  if (!DATASOURCE_RE.test(src)) {
    throw new Error("transformSchema: no datasource block found in source schema");
  }
  const withDatasource = src.replace(DATASOURCE_RE, SQLITE_DATASOURCE);
  const withoutNativeTypes = withDatasource.replace(DB_NATIVE_TYPE_RE, "");
  return HEADER + withoutNativeTypes;
}
