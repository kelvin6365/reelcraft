// Guard: every key declared in src/lib/env.ts exists in .env.example.
// Why: deploys fail silently when the example drifts from the real contract.
import { readFileSync } from "node:fs";
import { report } from "./lib.mjs";

const envTs = readFileSync("src/lib/env.ts", "utf8");
const example = readFileSync(".env.example", "utf8");

const keys = [...envTs.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):\s*z\./gm)].map((m) => m[1]);
const hits = keys
  .filter((k) => k !== "NODE_ENV")
  .filter((k) => !new RegExp(`^${k}=`, "m").test(example))
  .map((k) => `.env.example missing: ${k}`);
process.exit(report("env-example-sync", hits) ? 0 : 1);
