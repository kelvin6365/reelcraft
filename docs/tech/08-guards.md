# 08 · Guard 腳本（架構不變式 → CI 強制）

原則：**每個架構決策配一個 guard**。Guard = `scripts/guards/*.mjs`，靜態掃描 `src/`，違規時印出檔案+行號後 `exit 1`。全部掛載於 `npm run check`（CI + pre-commit）。AI agents 寫 code 時不會累積偏航——這是 solo×agents 工作法的核心保險。

## 現行清單（`scripts/guards/*.mjs`，`lib.mjs` 是共用 helper，不算獨立 guard）

| Guard | 檢查內容 | 對應鐵律 |
|---|---|---|
| `no-ai-bypass` | `src/lib/ai` 以外禁止 import adapter / 禁止出現 provider endpoint 字串 | CLAUDE.md #2 |
| `no-raw-env` | `process.env.` 只准出現於 `src/lib/env.ts` | 07-deployment |
| `no-inline-prompt` | `src/` 內禁止長中文指令字串模板——prompt 必須放在 `prompts/` | #7 |
| `no-media-url-in-db` | Prisma schema 禁止 `*Url` 欄位（media 一律使用 `*MediaId`） | #4 |
| `route-auth-check` | 所有 `app/api/**/route.ts` 必須使用 withAuth 或標示 `// PUBLIC:` 註解+原因 | 05-api-routes |
| `prompt-catalog-sync` | `prompts/catalog.json` ⇄ `prompts/pipeline/**` 一一對應；canary 樣本 render 後約束字句不失守 | 06-prompts |
| `prompt-resolve-check` | worker/route 必須經 `resolvePrompt`（帶 user/project override），禁止直接使用 `buildPrompt` 或直讀 prompt 檔 | #7 |
| `provider-registry-check` | provider registry / model catalog / 系統 model-defaults 三方一致；禁止復活 `fake::` fallback | #3, #8 |
| `reference-capability-check` | `standards/capabilities.json` 與 `src/lib/model-defaults/resolve.ts` 引用一致 | 03-provider |
| `capability-catalog-check` | `standards/capabilities.json` schema 驗證 + modelKey 格式 | 03-provider |
| `template-check` | `standards/templates/*.json` 結構驗證（宣告式媒體模板） | 03-provider §M2 |
| `env-example-sync` | `src/lib/env.ts` zod keys ⊆ `.env.example` | 07-deployment |
| `flashback-shot-isolation` | 閃回鏡必須同母場的場景參考圖／空間契約隔離（`pickShotLocation` + `filterBlockingForShot` 兩個 call site） | #8 |
| `sqlite-schema-sync` | `prisma/schema.sqlite.prisma` 必須是 `prisma/schema.prisma` 的轉換輸出，不得手改或轉舊 | #8 |
| `delivery-standards-check` | 四個 style pack 的 `negativePrompt` 必須齊備交付標準各缺陷類別；鏡頭生圖的 `referenceMediaIds` 必須由審計後的 refs 派生（孤兒參考圖守衛） | #8 · [交付標準](../plans/2026-08-03-delivery-standards-design.md) |

以上 guard 已全部掛載於 `npm run check`（`scripts/check.mjs` 自動掃描 `scripts/guards/*.mjs`，新增檔案即自動生效，無須註冊）。舊清單中的 `no-model-key-guess` / `no-plaintext-key-response` / `queue-route-exhaustive` / `no-polling` **未見對應腳本**，留待 orchestrator 決定是重新補寫還是移除這幾條要求。

## Canary（06-prompts.md）

`check:canary`（結構級，每次 CI）＋ `canary:live`（語意級，手動）。

## 慣例

- Guard 寫法：純 Node，無依賴，讀檔 + regex/簡單 AST（`typescript` compiler API 待有空時再用）。每個 guard 開頭應有一句註解說明「保護哪條決策、為何而設」。
- 新增架構決策的 PR **必須**在 PR 內附上 guard，這是 code review checklist 的第一條。
- Guard 誤殺：以白名單註解 `// guard-allow(<guard-name>): <原因>` 標示，guard 會識別並跳過，但每季須檢視白名單。
