# ReelCraft 🎬

貼上一段小說（或劇本 / SRT 字幕），選擇畫風與比例，八站引導流程即可產出一集 9:16 短劇成片。

AI 短劇生產平台：真多租戶、任務佇列具備 watchdog 兜底、每次 AI 呼叫全程審計（model / tokens / 成本逐筆記錄）、預算護欄防止超支。

## 特點

- **三步建專引導流** — 貼入故事（一鍵載入範例小說即可試用 / 上載 SRT 自動識別）→ 視覺化選擇畫風與比例 → 選擇產出方式，無需任何預備知識即可上手
- **八站引導流程** — 進度總覽條 + 常駐「下一步」卡片 + 失敗抽屜一鍵重試（同目標去重、附失敗時間），隨時清楚下一步
- **自動行進 + 花費檢查點** — 免費文字站（劇本→抽取資產→分鏡）自動接力執行；花費站（出圖／視頻／配音）必定停下提示，確認分鏡時一次列出「圖 + 視頻 + 配音 ≈ 總價」，授權後自動執行至成片
- **兩道人工審核閘** — 資產鎖定（三選一）與分鏡確認（附下游成本預覽），將下游重生成本降至最低
- **雙輸入模式** — 小說原文（LLM 全流程）或 SRT 字幕（確定性 1 cue = 1 鏡）
- **AI 劇集規劃** — 貼入整本小說自動分集（錨定集長或集數），🔴🟡🟢 風險圖示 review-by-exception，無需逐集深審
- **角色一致性** — 多視角 turnaround 定妝 + img2img 參考圖鎖定身份（图片N 綁定），跨鏡頭保持同一張臉
- **批量出片** — 一鍵全季自動生成：任務完成自動銜接下一站，分鏡可自動確認，跳過視頻的省錢模式，全季進度板逐集亮燈
- **模型三層預設** — 系統預設（真實模型）→ 個人預設（/settings）→ 逐專案覆寫；四種模態（文字／圖像／視頻／語音）任選，按 provider 分組，缺少 key 或能力不匹配時自動禁用；站台 UI 顯示現用模型與單價（fake 模型以橙色警告標示）
- **Provider 中立** — `provider::modelId` 嚴格契約；內建 OpenRouter / fal / AtlasCloud，亦可用一份 JSON 宣告式模板接入任意廠商
- **審計一切** — `callModel()` 唯一入口自動記帳；`/usage` 儀表板檢視成本、token、latency
- **進階模式** — 每個生產站可檢視／編輯實際送出的 AI prompt（用戶層／專案層覆寫，canary 鎖定結構）
- **生產級任務系統** — BullMQ ×4 + 心跳 + watchdog 殭屍恢復（worker 被 kill -9 後任務自動續跑）
- **商業化 ready** — BYO-Key 信封加密、預留→結算→退款計費帳本、Redis 分散式配額
- **零依賴 local 模式** — 沒有 Docker？自動改用 SQLite + 本機檔案 + 內嵌 worker，一條命令啟動
- **架構守則自動執行** — guard 腳本在 CI 鎖定架構不變式

## 快速開始（本機）

```bash
npm install
npm run dev   # 零 Docker：自動偵測環境、首次自動建立 .env 並完成資料庫設定
```

`npm run dev` 會先自動執行 bootstrap，再按偵測結果啟動對應 process：

- 沒有 `.env` 時由 `.env.example` 建立；沒有 API key 時設定 `MODEL_DEFAULTS_PRESET=fake`（fake providers 走完整流程，不產生費用）。
- **偵測不到 Postgres**（`DATABASE_URL` 3 秒內無法連通）→ 使用 **local 模式**：SQLite（`data/local.db`）+ worker 內嵌於同一個 `next dev` process，零 Docker、無需額外 terminal。
- **偵測到 Postgres** → 使用 **full 模式**：單一 terminal 同時啟動 web 與 worker（BullMQ + Redis）。

模式一經偵測即寫入 `.env`（`DEPLOY_MODE=local` 或 `full`），之後不會自行切換；若要強制使用完整版：手動設定 `DEPLOY_MODE=full` 並執行 `docker compose up -d`（postgres + redis + minio，或使用本機 brew 服務）。若要將 local 模式重置為全新狀態：`rm -rf data && npm run dev`。

如需分開執行 web／worker（full 模式，例如另開 terminal 除錯）：`npm run dev:web` 與 `npm run worker`。

開啟 http://localhost:3000 → 註冊 → 「開始製作」三步引導流（貼入小說或一鍵載入範例）→ 系統自動執行至檢查點，再按提示操作。沒有 API key 時設定 `MODEL_DEFAULTS_PRESET=fake` 亦可產出成片（ffmpeg 生成的佔位素材）；填入 `OPENROUTER_API_KEY` / `FAL_KEY` 後即為真實生成（系統預設 = kling-v3 / nano-banana-pro / minimax TTS，可於 `/settings` 或專案頁修改）。

## 驗證

```bash
npm run check                # guards + typecheck
npm test                     # 430+ tests
npm run smoke:pipeline       # 小說→mp4 離線 E2E（full 模式：postgres + BullMQ）
npm run smoke:pipeline:local # 同上，改行 local 模式（SQLite + 內嵌 worker，臨時資料庫）
npm run smoke:batch          # 兩集批量自動出片離線 E2E
npm run smoke:task           # kill -9 worker 恢復測試
```

## 部署

見 [docs/deploy.md](docs/deploy.md)（單 VPS docker-compose，app/worker 分離，可 `--scale worker=3`）。

## 文檔

- 產品設計：`docs/plans/2026-07-18-reelcraft-mvp-design.md`
- 技術 spec：`docs/tech/01-08`
- 架構鐵律：`CLAUDE.md`

## 技術棧

Next.js 16 · PostgreSQL + Prisma · BullMQ + Redis · MinIO/R2 · Better-Auth · ffmpeg

## 授權

[AGPL-3.0](LICENSE)。以本軟體提供網絡服務須開源您的修改；商業授權（豁免 AGPL 義務）另洽。
