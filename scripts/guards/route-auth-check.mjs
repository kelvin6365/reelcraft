// Guard: every app/api route is withAuth-wrapped or explicitly marked `// PUBLIC:` with a reason.
// Why: authz must be structural, not per-handler discipline (waoowaoo lesson).
import { readFileSync } from "node:fs";
import { walk, report } from "./lib.mjs";

const routes = walk("src/app/api", [".ts"]).filter((f) => f.endsWith("route.ts"));
const hits = [];
for (const f of routes) {
  const src = readFileSync(f, "utf8");
  const ok = src.includes("withAuth(") || src.includes("auth.api.getSession") || /\/\/ PUBLIC:\s*\S/.test(src);
  if (!ok) hits.push(`${f}  (no withAuth() and no "// PUBLIC: <reason>" marker)`);
}
process.exit(report("route-auth-check", hits) ? 0 : 1);
