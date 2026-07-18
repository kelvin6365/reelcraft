# 08 · Guard 腳本（架構不變式 → CI 強制）

原則：**每個架構決策配一個 guard**。Guard = `scripts/guards/*.mjs`，靜態掃描 `src/`，違規印出檔案+行號後 `exit 1`。全部掛 `npm run check`（CI + pre-commit）。AI agents 寫 code 唔會累積偏航——呢個係 solo×agents 工作法嘅核心保險。

## M0 起步清單

| Guard | 檢查乜 | 對應鐵律 |
|---|---|---|
| `no-ai-bypass` | adapter 目錄以外禁 import adapter、禁 provider endpoint 字串（queue.fal.run / openrouter.ai / atlascloud）、禁 adapter 以外讀 provider key env | CLAUDE.md #2 |
| `no-model-key-guess` | 禁裸 modelId 字串落 DB 欄／task payload（必須 `provider::modelId`）；`parseModelKeyStrict` 必須存在且被 callModel 使用 | #3 |
| `no-raw-env` | `process.env.` 只准出現喺 `src/lib/env.ts` | 07-deployment |
| `no-plaintext-key-response` | API route 回應唔准包含 `apiKey` 欄位（掃 route return shape + 常見字段名） | #5 |
| `no-inline-prompt` | `src/` 內禁長中文字串模板（>200 字且含「你是/必須/輸出」樣式）——prompt 必須喺 `prompts/` | #7 |
| `no-media-url-in-db` | Prisma schema 禁 `*Url` 欄（media 一律 `*MediaId`；白名單：exportUrl 都唔准，用 mediaId） | #4 |
| `route-auth-check` | 所有 `app/api/**/route.ts` 必須 withAuth 或標 `// PUBLIC:` 註解+原因 | 05-api-routes |
| `queue-route-exhaustive` | `getQueueForTaskType` switch 必須覆蓋所有 TASK_TYPE，冇 default fallthrough | 02-task-system |
| `no-polling` | 前端 code 禁 `setInterval` 打 `/api/tasks`（一律 SSE） | 02-task-system |
| `prompt-catalog-sync` | `prompts/catalog.json` 同 `prompts/**` 檔案一一對應；變數宣告同模板 placeholder 一致 | 06-prompts |
| `capability-catalog-check` | `standards/capabilities.json` schema 驗證 + modelKey 格式 | 03-provider |
| `env-example-sync` | `src/lib/env.ts` zod keys ⊆ `.env.example` | 07-deployment |

## Canary（06-prompts.md）

`check:canary`（結構級，每次 CI）＋ `canary:live`（語意級，手動）。

## 慣例

- Guard 寫法：純 Node，冇依賴，讀檔 + regex/簡單 AST（`typescript` compiler API 得閒先用）。每個 guard 頭部一句註解講「保護邊條決策、點解」。
- 新增架構決策嘅 PR **必須**同 PR 內附 guard，code review checklist 第一條。
- Guard 誤殺：白名單註解 `// guard-allow(<guard-name>): <原因>`，guard 識別並跳過，但每季 review 白名單。
