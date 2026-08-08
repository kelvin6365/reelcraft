// Guard: 閃回鏡頭一定要同母場嘅場景參考圖／空間契約隔離（CLAUDE.md #8）。
//
// 架構決策：閃回唔切場（切開 → 同一地點各自鎖一份空間契約 → 跳軸），改為 Shot.flashback
// 逐鏡標記，隔離喺兩個 call site 做——pickShotLocation（唔畀母場場景參考圖）同
// filterBlockingForShot（剝走母場空間契約）。
//
// Why 要 guard：呢兩個隔離**唔會自己出錯**，只會被「新加一個 call site 冇傳 flashback」
// 靜默繞過——同 blocking 當初繞過 characters 層所有防線一模一樣。漏傳嘅後果係閃回鏡攞返
// 母場背景（實測：兩年前喺電腦前 → 出圖係龍巢穴同一條死龍），冇任何錯誤訊息。
// 型別擋唔到：兩個參數都係 optional（要 optional，因為好多測試同非生圖路徑真係唔關事）。
//
// 檢查：src/ 入面每一個 pickShotLocation( / filterBlockingForShot( 嘅呼叫，其後幾行之內
// 要出現 `flashback`。真係唔關事嘅呼叫寫 `guard-allow(flashback-isolation)` 豁免。
import { readFileSync } from "node:fs";
import { walk, report } from "./lib.mjs";
import { relative } from "node:path";

const GUARDED = ["pickShotLocation(", "filterBlockingForShot("];
// 一個呼叫最多攤幾多行（實際 4-6 行，畀啲鬆動位）
const CALL_SPAN = 10;

const hits = [];
for (const file of walk("src")) {
  // 定義本身唔係呼叫
  if (file.endsWith("shot-assets.ts") || file.endsWith("shot-blocking.ts")) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const fn = GUARDED.find((f) => line.includes(f));
    if (!fn) return;
    const window = lines.slice(i, i + CALL_SPAN).join("\n");
    if (window.includes("guard-allow(flashback-isolation)")) return;
    if (window.includes("flashback")) return;
    hits.push(
      `${relative(process.cwd(), file)}:${i + 1}  ${fn.slice(0, -1)} 冇傳 flashback — 閃回鏡會攞返母場嘅背景／空間契約`,
    );
  });
}

process.exit(report("flashback-shot-isolation", hits) ? 0 : 1);
