# CLAUDE.md — ReelCraft

AI 短劇生產平台。開工前先讀 `docs/plans/2026-07-18-reelcraft-mvp-design.md`（產品設計真相來源）；實作細節見 `docs/tech/`。

## 鐵律（架構不變式，違反 = 錯）

1. **所有表帶 `userId`** — 多租戶由第一日 ready，沒有例外。
2. **所有 AI 呼叫必須經 `callModel()` / `generateMedia()` 唯一入口** — 入口自動寫 AiCallLog（audit 硬性要求）。禁止直連 provider SDK。
3. **Model 引用一律 `provider::modelId` 複合 key** — 禁止 provider 猜測、靜態映射、預設降級。
4. **DB 只存 storage key，不存媒體 URL** — 一切經 MediaObject，讀取時簽名 URL 水合。
5. **API 永不回傳明文金鑰。**
6. **重試由 app 層決定** — retryable（429/超時/5xx）先入 BullMQ 退避；terminal 錯誤即 fail。
7. **Prompt 是資產** — 放 `prompts/`，變數嚴格驗證，canary 迴歸鎖結構；不准 inline 寫在 code 中。
8. **每個架構決策配一個 guard 腳本**（`scripts/guards/`），CI 強制。

## 授權警示

參考項目 huobao-drama（CC BY-NC-SA）、Toonflow（Apache+商業限制）、waoowaoo（CC BY-NC-SA）的**程式碼與 prompt 原文一律不得複製**——只使用架構模式與思想，全部從零實作。

## 開發陷阱

- **沒有 provider key 的環境要設定 `MODEL_DEFAULTS_PRESET=fake`**。系統模型預設為真實模型（三層解析：system → user → project，見 `docs/tech/03-provider-layer.md`），未設定 preset 又沒有 key → 生成即出現 `PROVIDER_KEY_MISSING`。smoke scripts / CI 也都要設定。

- **修改了 schema.prisma / 跑了 migration 之後，一定要重啟 dev server**。Next dev 持有的是舊版 `@prisma/client`，新 model 會是 `undefined` → route 500。`npx prisma generate` 並不足夠，必須重啟該 process。
- **worker 使用 `npm run worker`（tsx watch）會自動 reload code**——修改 handler/adapter 不需要手動重啟。但 migration 後 Prisma client 需要重新生成，worker 也要跟著 reload（修改任何 .ts 都會觸發；或手動重啟）。單次執行使用 `npm run worker:once`。
- dev 時 web 與 worker **兩者都必須在運行**：`npm run dev` 已一條命令同時啟動（full 模式 concurrently 兩個 process；local 模式 worker 內嵌於同一 process）。worker 若停止運作 → 生成任務會卡在 queued。若手動分開執行，使用 `npm run dev:web` + `npm run worker`。

## 工作法

- 每個 PR 一條薄片：交付必須貫通「貼文→出成品」的某一段。
- YAGNI：事件溯源 run / 畫布 / Agent 對話層 / 多語 UI / ENFORCE 計費——全部留到 M2 之後再考慮。
- 語言：UI 文案為繁體中文（粵語風味）；文檔為標準書面繁體中文；code 與 identifier 為英文。
