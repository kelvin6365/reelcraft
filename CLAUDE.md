# CLAUDE.md — ReelCraft

AI 短劇生產平台（設計階段）。開工前先讀 `docs/plans/2026-07-18-reelcraft-mvp-design.md` — 佢係唯一真相來源。

## 鐵律（架構不變式，違反 = 錯）

1. **所有表帶 `userId`** — 多租戶由第一日 ready，冇例外。
2. **所有 AI 呼叫必須經 `callModel()` / `generateMedia()` 唯一入口** — 入口自動寫 AiCallLog（audit 硬性要求）。禁止直連 provider SDK。
3. **Model 引用一律 `provider::modelId` 複合 key** — 禁止 provider 猜測、靜態映射、預設降級。
4. **DB 只存 storage key，唔存媒體 URL** — 一切經 MediaObject，讀取時簽名 URL 水合。
5. **API 永不回傳明文金鑰。**
6. **重試由 app 層話事** — retryable（429/超時/5xx）先入 BullMQ 退避；terminal 錯誤即 fail。
7. **Prompt 係資產** — 放 `prompts/`，變數嚴格驗證，canary 迴歸鎖結構；唔准 inline 喺 code 度。
8. **每個架構決策配一個 guard 腳本**（`scripts/guards/`），CI 強制。

## 授權警示

參考項目 huobao-drama（CC BY-NC-SA）、Toonflow（Apache+商業限制）、waoowaoo（CC BY-NC-SA）嘅**程式碼同 prompt 原文一律不得複製**——只用架構模式與思想，全部從零實作。

## 開發陷阱

- **冇 provider key 嘅環境要設 `MODEL_DEFAULTS_PRESET=fake`**。系統模型預設係真模型（三層解析：system → user → project，見 `docs/tech/03-provider-layer.md`），唔設 preset 又冇 key → 生成即 `PROVIDER_KEY_MISSING`。smoke scripts / CI 都要設。

- **改咗 schema.prisma / 跑咗 migration 之後,一定要重啟 dev server**。Next dev 揸住舊 `@prisma/client`,新 model 會係 `undefined` → route 500。`npx prisma generate` 唔夠,要重啟個 process。
- **worker 用 `npm run worker`（tsx watch）會自動 reload code**——改咗 handler/adapter 唔使手動重啟。但 migration 後個 Prisma client 要重生,worker 亦要跟住 reload（改任何 .ts 都會觸發；或者手動重啟）。單次跑用 `npm run worker:once`。
- dev 要 **web + worker 兩個 process 都行住**（`npm run dev` + `npm run worker`）。worker 死咗 → 生成任務會卡喺 queued（dev 冇 watchdog 兜底，生產先有）。

## 工作法

- 每個 PR 一條薄片：交付必須駁通「貼文→出嘢」某一段。
- YAGNI：事件溯源 run / 畫布 / Agent 對話層 / 多語 UI / ENFORCE 計費——全部 M2 之後先諗。
- 語言：UI 同文檔繁體中文；code 同 identifier 英文。
