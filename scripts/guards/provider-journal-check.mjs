// Guard: 每個 provider submit 都必須經 runJournaled() 落 journal（CLAUDE.md #8）。
// Why: submit 完直接 poll 嘅寫法，會令 request_id 淨係活喺記憶體 —— worker 一
// 重啟就攞唔返，舊 request 繼續燒 GPU 冇人收貨，重試又再 submit 一次（俾兩次錢）。
// 見 src/lib/ai/request-journal.ts。
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { walk, scan, report } from "./lib.mjs";

const ENTRY = "src/lib/ai/generate-media.ts";
const hits = [];

// 1) generate-media.ts 入面每個 *Submit( 呼叫都要係 runJournaled 嘅 `submit:` ops。
const entryLines = readFileSync(ENTRY, "utf8").split("\n");
entryLines.forEach((line, i) => {
  if (!/\b\w+Submit\(/.test(line)) return;
  if (line.includes("submit:")) return;
  hits.push(`${ENTRY}:${i + 1}  submit 冇經 runJournaled — ${line.trim().slice(0, 100)}`);
});

// 2) 每個 runJournaled 都要有 submit: 同 poll: 兩隻 ops。
const count = (re) => (readFileSync(ENTRY, "utf8").match(re) ?? []).length;
const journaled = count(/runJournaled[<(]/g);
if (journaled === 0) hits.push(`${ENTRY}  搵唔到 runJournaled —— journal 被拆走咗？`);
if (count(/\bsubmit:\s/g) !== journaled) hits.push(`${ENTRY}  runJournaled 同 submit: ops 數目對唔上`);
if (count(/\bpoll:\s/g) !== journaled) hits.push(`${ENTRY}  runJournaled 同 poll: ops 數目對唔上`);
// 收貨之後一定要 markConsumed，否則行會永遠 pending，重試時會攞返舊 request。
if (count(/markConsumed\(/g) < journaled) hits.push(`${ENTRY}  markConsumed 少過 runJournaled —— 有路徑冇埋單`);

// 3) 其他檔案唔准直接 import adapter 嘅 submit/poll seam（要行 generate-media 唯一入口）。
const others = walk("src").filter((f) => relative(process.cwd(), f) !== ENTRY && !f.includes("src/lib/ai/adapters"));
hits.push(
  ...scan(others, (line) => /\b(fal|atlas)(Image|Video|Tts)Submit\b|\b(falPoll|atlasPoll)\b/.test(line)),
);

process.exit(report("provider-journal-check", hits) ? 0 : 1);
