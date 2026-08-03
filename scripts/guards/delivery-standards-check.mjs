// 交付標準守衛（docs/plans/2026-08-03-delivery-standards-design.md）。
//
// 守兩個決定：
//
// ① style pack 嘅 negativePrompt 必須齊備交付標準各缺陷類別。
//    呢批詞係 L3 唯一防線 —— 光影缺陷、皮膚塑料感、幼態臉、醜化畸形、人體結構、敏感標誌
//    全部冇任何 L1/L2 兜得返（生圖模型畫成點，code 睇唔到）。日後加新 style pack 若果
//    照抄舊 pack 嘅骨架但漏咗呢批詞，就會靜靜地跌返落標準以下，所以要 CI 擋。
//
// ② 鏡頭生圖送出去嘅參考圖必須經過孤兒審計。
//    核心不變式：送出去嘅每一張參考圖，prompt 入面都要有 Image N 綁住（見
//    src/lib/prompts/shot-prompt-audit.ts）。referenceMediaIds 若果直接由未審計嘅 refs
//    派生，孤兒圖就會照樣送出去，生圖模型會攞去亂認人（鏡 25 四個複製人）。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { report } from "./lib.mjs";

const STYLES_DIR = "prompts/styles";
const MEDIA_HANDLERS = "src/lib/workers/handlers/media-handlers.ts";

// 每類至少要有一個代表詞 —— 逐字鎖死成張詞表會令調整用詞都要改 guard，太脆。
const REQUIRED_NEGATIVE_CATEGORIES = {
  "光影缺陷": ["half-lit face", "harsh split lighting", "hard-edged shadow"],
  "皮膚質感": ["oily skin", "waxy skin", "mask-like face"],
  "幼態臉": ["childlike face", "baby face", "underage appearance"],
  "醜化畸形": ["ugly face", "disfigured face", "asymmetrical features"],
  "人體結構": ["broken anatomy", "malformed limbs", "clothing clipping"],
  "敏感標誌": ["dragon emblem", "police badge", "military insignia"],
};

const hits = [];

// ① style pack 負面詞覆蓋
let packs = [];
try {
  packs = readdirSync(STYLES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
} catch (err) {
  hits.push(`cannot read ${STYLES_DIR}: ${String(err)}`);
}

if (packs.length === 0 && hits.length === 0) hits.push(`${STYLES_DIR}: no style packs found`);

for (const pack of packs) {
  const path = join(STYLES_DIR, pack, "style.json");
  let style;
  try {
    style = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    hits.push(`${path}: cannot parse — ${String(err)}`);
    continue;
  }
  const negative = String(style.negativePrompt ?? "").toLowerCase();
  for (const [category, terms] of Object.entries(REQUIRED_NEGATIVE_CATEGORIES)) {
    if (!terms.some((t) => negative.includes(t))) {
      hits.push(`${path}: negativePrompt 缺「${category}」類負面詞（至少要有一個：${terms.join(" / ")}）`);
    }
  }
}

// ② 鏡頭參考圖必須經孤兒審計
try {
  const src = readFileSync(MEDIA_HANDLERS, "utf8");
  if (!src.includes("dropOrphanRefs(")) {
    hits.push(`${MEDIA_HANDLERS}: 鏡頭生圖冇行 dropOrphanRefs —— 孤兒參考圖會令生圖模型亂認人`);
  }
  // referenceMediaIds 一定要由審計後嘅 refs 派生，唔可以由原始 refs 直接 map
  for (const [i, line] of src.split("\n").entries()) {
    if (!line.includes("const referenceMediaIds")) continue;
    if (!line.includes("audited.refs")) {
      hits.push(`${MEDIA_HANDLERS}:${i + 1}  referenceMediaIds 必須由 audited.refs 派生，唔可以用未審計嘅 refs`);
    }
  }
} catch (err) {
  hits.push(`cannot read ${MEDIA_HANDLERS}: ${String(err)}`);
}

process.exit(report("delivery-standards-check", hits) ? 0 : 1);
