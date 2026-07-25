# 08 · Guard 腳本（架構不變式 → CI 強制）

原則：**每個架構決策配一個 guard**。Guard = `scripts/guards/*.mjs`，靜態掃描 `src/`，違規印出檔案+行號後 `exit 1`。全部掛 `npm run check`（CI + pre-commit）。AI agents 寫 code 唔會累積偏航——呢個係 solo×agents 工作法嘅核心保險。

## 現行清單（`scripts/guards/*.mjs`，`lib.mjs` 係共用 helper 唔算獨立 guard）

| Guard | 檢查乜 | 對應鐵律 |
|---|---|---|
| `no-ai-bypass` | `src/lib/ai` 以外禁 import adapter / 禁 provider endpoint 字串 | CLAUDE.md #2 |
| `no-raw-env` | `process.env.` 只准出現喺 `src/lib/env.ts` | 07-deployment |
| `no-inline-prompt` | `src/` 內禁長中文指令字串模板——prompt 必須喺 `prompts/` | #7 |
| `no-media-url-in-db` | Prisma schema 禁 `*Url` 欄（media 一律 `*MediaId`） | #4 |
| `route-auth-check` | 所有 `app/api/**/route.ts` 必須 withAuth 或標 `// PUBLIC:` 註解+原因 | 05-api-routes |
| `prompt-catalog-sync` | `prompts/catalog.json` ⇄ `prompts/pipeline/**` 一一對應；canary 樣本render後約束字句唔失守 | 06-prompts |
| `prompt-resolve-check` | worker/route 必須經 `resolvePrompt`（帶 user/project override），禁直接 `buildPrompt` 或直讀 prompt 檔 | #7 |
| `provider-registry-check` | provider registry / model catalog / 系統 model-defaults 三方一致；禁復活 `fake::` fallback | #3, #8 |
| `reference-capability-check` | `standards/capabilities.json` 同 `src/lib/model-defaults/resolve.ts` 引用一致 | 03-provider |
| `capability-catalog-check` | `standards/capabilities.json` schema 驗證 + modelKey 格式 | 03-provider |
| `template-check` | `standards/templates/*.json` 結構驗證（宣告式媒體模板） | 03-provider §M2 |
| `env-example-sync` | `src/lib/env.ts` zod keys ⊆ `.env.example` | 07-deployment |

以上 12 個 guard 已全部掛 `npm run check`。舊清單中嘅 `no-model-key-guess` / `no-plaintext-key-response` / `queue-route-exhaustive` / `no-polling` **未見對應腳本**，留待 orchestrator 決定係重新補寫定係移除呢幾條要求。

## Canary（06-prompts.md）

`check:canary`（結構級，每次 CI）＋ `canary:live`（語意級，手動）。

## 慣例

- Guard 寫法：純 Node，冇依賴，讀檔 + regex/簡單 AST（`typescript` compiler API 得閒先用）。每個 guard 頭部一句註解講「保護邊條決策、點解」。
- 新增架構決策嘅 PR **必須**同 PR 內附 guard，code review checklist 第一條。
- Guard 誤殺：白名單註解 `// guard-allow(<guard-name>): <原因>`，guard 識別並跳過，但每季 review 白名單。
