# ReelCraft 技術文檔

實作級 spec，配合 `docs/plans/2026-07-18-reelcraft-mvp-design.md`（產品設計）同根目錄 `CLAUDE.md`（鐵律）使用。衝突時以 plans 文檔決策為準，實作細節以本目錄為準。

| 文檔 | 內容 | 對應里程碑 |
|---|---|---|
| [01-data-model.md](01-data-model.md) | 全部資料表、欄位、索引、狀態機 | M0 |
| [02-task-system.md](02-task-system.md) | 佇列、worker、watchdog、SSE、重試策略 | M0–M1 |
| [03-provider-layer.md](03-provider-layer.md) | provider 契約、三個 adapter、能力目錄 | M0–M1 |
| [04-audit.md](04-audit.md) | AuditLog / AiCallLog / callModel() 入口 | M0 |
| [05-api-routes.md](05-api-routes.md) | API 路由表 + auth 規則 | M1 |
| [06-prompts.md](06-prompts.md) | prompt 目錄、變數驗證、canary、畫風包格式 | M1 |
| [07-deployment.md](07-deployment.md) | docker-compose、env vars、啟動順序 | M0 |
| [08-guards.md](08-guards.md) | guard 腳本清單 + 各自檢查乜 | M0 起持續 |
