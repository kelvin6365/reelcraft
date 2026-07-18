// Guard: process.env may only be read in src/lib/env.ts (docs/tech/07-deployment.md).
// Why: env access must be validated + fail-fast in one place; scattered reads rot.
import { walk, scan, report } from "./lib.mjs";

const files = walk("src").filter((f) => !f.endsWith("src/lib/env.ts"));
const hits = scan(files, (line) => line.includes("process.env"), { allowTag: "no-raw-env" });
process.exit(report("no-raw-env", hits) ? 0 : 1);
