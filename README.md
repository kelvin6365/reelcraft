# ReelCraft

貼一段小說（或劇本/SRT），揀畫風同比例，八站引導流程出一集 9:16 短劇成片。

AI 短劇生產平台 — 先內部（2rocks studio）驗證，架構預留多租戶，之後行「開源核心 + 託管收費」雙軌。

## 狀態

設計階段。MVP 設計文檔：[docs/plans/2026-07-18-reelcraft-mvp-design.md](docs/plans/2026-07-18-reelcraft-mvp-design.md)

前置研究：三個開源參考項目（huobao-drama / Toonflow / waoowaoo）嘅深度對比報告 — `~/Projects/ai-drama-platforms-report.html`。

## 技術棧（規劃）

Next.js 16 · PostgreSQL + Prisma · BullMQ + Redis · MinIO/R2 · Better-Auth

MVP 廠商：OpenRouter（text）· fal（image/video/TTS）· AtlasCloud（媒體副選）
