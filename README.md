# ReelCraft 🎬

貼一段小說（或劇本 / SRT 字幕），揀畫風同比例，八站引導流程出一集 9:16 短劇成片。

AI 短劇生產平台：真多租戶、任務佇列有 watchdog 兜底、每次 AI 呼叫全審計（model / tokens / 成本一分一毫有數）、預算護欄防超支。

## 特點

- **八站引導流程** — 進度總覽條 + 常駐「下一步」卡 + 失敗抽屜一鍵重試，永遠知道下一步
- **兩個人手審核閘** — 資產鎖定（3 選 1）同分鏡確認（附下游成本預覽），下游重生成本最細
- **雙輸入模式** — 小說原文（LLM 全流程）或 SRT 字幕（確定性 1 cue = 1 鏡）
- **AI 劇集規劃** — 貼全本小說自動分集（錨定集長或集數），🔴🟡🟢 風險圖示 review-by-exception，唔使逐集深審
- **角色一致性** — 多視角 turnaround 定妝 + img2img 參考圖鎖定身份（图片N 綁定），跨鏡頭同一張臉
- **批量出片** — 一鍵全季自動生成：task 完成自動接下一站，分鏡可自動確認，跳視頻省錢模式，全季進度板逐集亮燈
- **影像模型任揀** — nano-banana / nano-banana-pro / Seedream v4 逐專案切換，成本價目寫入能力目錄
- **Provider 中立** — `provider::modelId` 嚴格契約；OpenRouter / fal / AtlasCloud 內建，或者用一份 JSON 宣告式模板接任意廠商
- **審計一切** — `callModel()` 唯一入口自動記帳；`/usage` 儀表板睇成本、token、latency
- **生產級任務系統** — BullMQ ×4 + 心跳 + watchdog 殭屍恢復（kill -9 worker 任務自動續跑）
- **商業化 ready** — BYO-Key 信封加密、預留→結算→退款計費帳本、Redis 分散式配額
- **架構守則自動執行** — 10+ guard 腳本喺 CI 鎖住不變式

## 快速開始（本機）

```bash
npm install
cp .env.example .env          # 可以乜都唔填 — fake providers 走全程
docker compose up -d          # postgres + redis + minio（或用本機 brew 服務）
npx prisma migrate dev
npm run dev                   # web
npm run worker                # 另一個 terminal
```

開 http://localhost:3000 → 註冊 → 建專案 → 貼小說 → 跟住右下角張卡撳。冇 API key 都出到片（ffmpeg 生成嘅佔位素材）；填咗 `OPENROUTER_API_KEY` / `FAL_KEY` 就係真嘢。

## 驗證

```bash
npm run check          # 10+ guards + typecheck
npm test               # 137+ tests
npm run smoke:pipeline # 小說→mp4 離線 E2E
npm run smoke:batch    # 兩集批量自動出片離線 E2E
npm run smoke:task     # kill -9 worker 恢復測試
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
