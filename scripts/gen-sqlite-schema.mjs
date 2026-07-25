// Generates prisma/schema.sqlite.prisma from prisma/schema.prisma (the source of
// truth) for local quickstart mode (docs/plans/2026-07-25-local-quickstart-design.md §2).
// Checked in; kept in sync by scripts/guards/sqlite-schema-sync.mjs.
import { readFileSync, writeFileSync } from "node:fs";
import { transformSchema } from "./lib-sqlite-transform.mjs";

const SOURCE = "prisma/schema.prisma";
const TARGET = "prisma/schema.sqlite.prisma";

const src = readFileSync(SOURCE, "utf8");
const out = transformSchema(src);
writeFileSync(TARGET, out);
console.log(`✓ wrote ${TARGET} from ${SOURCE}`);
