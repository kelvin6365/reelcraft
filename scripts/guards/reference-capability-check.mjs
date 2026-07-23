import { readFileSync } from "node:fs";
import { report } from "./lib.mjs";

const CATALOG = "standards/capabilities.json";
const RESOLVE = "src/lib/model-defaults/resolve.ts";

const hits = [];

let catalog;
try {
  catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
} catch (err) {
  console.error(`✗ reference-capability-check — cannot read ${CATALOG}: ${String(err)}`);
  process.exit(1);
}

const refCapable = new Map();
if (!Array.isArray(catalog)) {
  hits.push("root must be a JSON array");
} else {
  for (const [i, e] of catalog.entries()) {
    if (!e || e.apiType !== "image") continue;
    const flag = e.capabilities?.supportsReferenceImages;
    if (typeof flag !== "boolean") {
      hits.push(
        `entry[${i}] (${e.modelKey}): image models must declare capabilities.supportsReferenceImages explicitly (true/false), got ${JSON.stringify(flag)}`,
      );
      continue;
    }
    refCapable.set(e.modelKey, flag);
  }
}

let resolveSrc = "";
try {
  resolveSrc = readFileSync(RESOLVE, "utf8");
} catch (err) {
  console.error(`✗ reference-capability-check — cannot read ${RESOLVE}: ${String(err)}`);
  process.exit(1);
}
const block = resolveSrc.match(/SYSTEM_MODEL_DEFAULTS[^{]*\{([^}]*)\}/);
if (!block) {
  hits.push(`${RESOLVE}: could not locate SYSTEM_MODEL_DEFAULTS literal`);
} else {
  const image = block[1].match(/image\s*:\s*["'`]([^"'`]+)["'`]/);
  if (!image) {
    hits.push(`${RESOLVE}: SYSTEM_MODEL_DEFAULTS has no image entry`);
  } else if (refCapable.get(image[1]) !== true) {
    hits.push(
      `${RESOLVE}: SYSTEM_MODEL_DEFAULTS.image is ${image[1]}, which does not declare supportsReferenceImages: true — the shot pipeline always sends reference images, so the system floor must accept them`,
    );
  }
}

process.exit(report("reference-capability-check", hits) ? 0 : 1);
