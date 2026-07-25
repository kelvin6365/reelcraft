# ReelCraft 🎬

貼一段小說（或劇本 / SRT 字幕），揀畫風同比例，八站引導流程出一集 9:16 短劇成片。

AI 短劇生產平台：真多租戶、任務佇列有 watchdog 兜底、每次 AI 呼叫全審計（model / tokens / 成本一分一毫有數）、預算護欄防超支。

## 特點

- **三步建專引導流** — 貼故事（一撳範例小說即試 / SRT 上載自動識別）→ 視覺化揀畫風同比例 → 揀出法，唔使任何預備知識就開到工
- **八站引導流程** — 進度總覽條 + 常駐「下一步」卡 + 失敗抽屜一鍵重試（同目標去重、附失敗時間），永遠知道下一步
- **自動行進 + 使錢檢查點** — 免費文字站（劇本→抽資產→分鏡）自動接力；使錢站（出圖/視頻/配音）一定停低亮燈，確認分鏡一次過睇齊「圖+視頻+配音≈總價」先授權行到成片
- **兩個人手審核閘** — 資產鎖定（3 選 1）同分鏡確認（附下游成本預覽），下游重生成本最細
- **雙輸入模式** — 小說原文（LLM 全流程）或 SRT 字幕（確定性 1 cue = 1 鏡）
- **AI 劇集規劃** — 貼全本小說自動分集（錨定集長或集數），🔴🟡🟢 風險圖示 review-by-exception，唔使逐集深審
- **角色一致性** — 多視角 turnaround 定妝 + img2img 參考圖鎖定身份（图片N 綁定），跨鏡頭同一張臉
- **批量出片** — 一鍵全季自動生成：task 完成自動接下一站，分鏡可自動確認，跳視頻省錢模式，全季進度板逐集亮燈
- **模型三層預設** — 系統預設（真模型）→ 個人預設（/settings）→ 逐專案覆寫，四種模態（文字/圖像/視頻/語音）任揀，按 provider 分組、缺 key 或能力唔匹配自動禁用；站 UI 顯示現用模型 + 單價（fake 亮橙色警告）
- **Provider 中立** — `provider::modelId` 嚴格契約；OpenRouter / fal / AtlasCloud 內建，或者用一份 JSON 宣告式模板接任意廠商
- **審計一切** — `callModel()` 唯一入口自動記帳；`/usage` 儀表板睇成本、token、latency
- **進階模式** — 每個生產站可以檢視／編輯實際送出嘅 AI prompt（用戶層／專案層覆寫，canary 鎖結構）
- **生產級任務系統** — BullMQ ×4 + 心跳 + watchdog 殭屍恢復（kill -9 worker 任務自動續跑）
- **商業化 ready** — BYO-Key 信封加密、預留→結算→退款計費帳本、Redis 分散式配額
- **零依賴 local 模式** — 冇 Docker？自動落 SQLite＋本機檔案＋內嵌 worker，一條命令跑起
- **架構守則自動執行** — guard 腳本喺 CI 鎖住不變式

## 快速開始（本機）

```bash
npm install
npm run dev   # 零 Docker：自動偵測、首次會建 .env、跑 db 設定，出到片
```

`npm run dev` 會先自動跑 bootstrap，再按偵測結果起對應 process：

- 冇 `.env` 就由 `.env.example` 建立；冇 API key 就設 `MODEL_DEFAULTS_PRESET=fake`（fake providers 走全程，唔使錢）。
- **偵測唔到 Postgres**（`DATABASE_URL` 3 秒 ping 唔通）→ 用 **local 模式**：SQLite（`data/local.db`）+ worker 內嵌喺同一個 `next dev` process，零 Docker、零額外 terminal。
- **偵測到 Postgres** → 用 **full 模式**：一個 terminal 齊起 web＋worker（BullMQ + Redis），同以前一樣。

模式一經偵測會寫死入 `.env`（`DEPLOY_MODE=local` 或 `full`），唔會之後靜靜轉；想強制用完整版：手動設 `DEPLOY_MODE=full` 並 `docker compose up -d`（postgres + redis + minio，或本機 brew 服務）。想由 local 打回白紙：`rm -rf data && npm run dev`。

想分開行 web／worker（full 模式，例如另開 terminal debug）：`npm run dev:web` 同 `npm run worker`。

開 http://localhost:3000 → 註冊 → 「開始製作」三步引導流（貼小說或一撳用範例）→ 系統自動行到檢查點，跟住亮燈位撳。冇 API key 設 `MODEL_DEFAULTS_PRESET=fake` 都出到片（ffmpeg 生成嘅佔位素材）；填咗 `OPENROUTER_API_KEY` / `FAL_KEY` 就係真嘢（系統預設 = kling-v3 / nano-banana-pro / minimax TTS，`/settings` 或專案頁可改）。

## 驗證

```bash
npm run check                # guards + typecheck
npm test                     # 430+ tests
npm run smoke:pipeline       # 小說→mp4 離線 E2E（full 模式：postgres + BullMQ）
npm run smoke:pipeline:local # 同上，但行 local 模式（SQLite + 內嵌 worker，throwaway db）
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

[AGPL-3.0](LICENSE)。以本軟體提供網絡服務須開源你嘅修改；商業授權（免 AGPL 義務）另洽。
