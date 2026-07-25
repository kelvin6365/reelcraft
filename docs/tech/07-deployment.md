# 07 · 部署（docker-compose 單 VPS）

## 拓撲（六個 service）

```yaml
services:
  app:       # next start（只有 web，沒有 worker —— 與 waoowaoo 的單容器綁定劃清界線）
  worker:    # tsx src/workers/index.ts + watchdog（同一容器內兩個 process，由 tini 管理）
  postgres:  # postgres:17-alpine，volume pg_data
  redis:     # redis:7-alpine --appendonly yes，volume redis_data
  minio:     # minio/minio，volume minio_data（上線後可換成 R2，僅需改 env）
  ffmpeg 由 worker 鏡像內建（apk add ffmpeg）——COMPOSE_EPISODE 於 worker 中執行
```

- `app` `depends_on` postgres/redis healthy；`worker` 再加上 minio。
- migrate：`app` 啟動 command 先執行 `prisma migrate deploy` 再 `next start`（不准使用 db push）。
- 反向代理：Caddy 位於 host 層（自動 HTTPS），`/` → app:3000。Bull Board 待 M2 才加入（掛載於 `/admin/queues` + basic auth）。

## Dockerfile

- app：三段式 `node:22-alpine`（deps → build（prisma generate + next build）→ runner），runner 不保留 devDeps。
- worker：同一 base，多裝 `ffmpeg`；入口為 `tsx`（worker code 不需要 build）。
- 兩個 image 使用一個 repo 兩個 target（`--target app` / `--target worker`）。

## Env vars（.env.example 必須同步維護，guard 驗證齊全）

```
DATABASE_URL=postgresql://…
REDIS_URL=redis://redis:6379
STORAGE_ENDPOINT / STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY / STORAGE_BUCKET   # MinIO 或 R2
BETTER_AUTH_SECRET / BETTER_AUTH_URL
OPENROUTER_API_KEY / FAL_KEY / ATLASCLOUD_API_KEY
QUEUE_CONCURRENCY_TEXT=8 / _IMAGE=10 / _VIDEO=4 / _VOICE=8
WATCHDOG_INTERVAL_MS=30000 / TASK_HEARTBEAT_TIMEOUT_MS=90000
BILLING_MODE=SHADOW
LOG_LEVEL=info
```

規則：**env 只在 `src/lib/env.ts` 讀取一次**（以 zod 驗證，缺項即啟動時 fail-fast）；其他檔案 import env object。Guard 掃描 `process.env.` 是否出現於 env.ts 以外的地方。

## 啟動順序 / 健康檢查

- `GET /api/health`：DB ping + Redis ping + storage head-bucket → `{ok, checks}`。
- compose healthcheck 所有 service 皆有；worker 健康狀態 = watchdog 心跳檔案 mtime < 60s。

## 備份

- postgres：每晚以 `pg_dump` 備份至 storage bucket `backups/`（cron 於 worker 容器中執行）。
- MinIO data volume 本身即為媒體真身——上到 R2 之後這一層已無單點問題。

## Local 模式（單人本機，零 Docker）

`DEPLOY_MODE=local`（`npm run dev` 偵測不到 Postgres 時會自動選用，詳見 README／`docs/plans/2026-07-25-local-quickstart-design.md`）是一個平行拓撲，而非上述六個 service 拓撲的簡化版：

- **單一 process**：Next `next dev` 單一 process 同時啟動 web + worker（worker 內嵌於 `src/instrumentation.ts` 的 DB poller，不執行獨立的 `npm run worker`）。
- **DB**：SQLite，`data/local.db`（`prisma/schema.sqlite.prisma`，使用 `prisma db push` 而非 migration 歷史）。
- **Redis 替身**：queue / SSE pubsub / quota / rate-limit 全部改用 in-process 版本（單一 Map / EventEmitter），語義在單一 process 內與 full 模式一致；**重啟後歸零**（配額、rate-limit window）。
- **Storage**：同樣使用 `STORAGE_TYPE=local`（`data/storage/`），本身不依賴 MinIO。

**單人限制**：local 模式沒有跨 process 協調——不支援 `--scale worker=N`、不支援多個 `next dev` 例項共享同一個 `data/local.db`（SQLite 並發寫入能力較弱）。生產環境／多人使用一律必須採用 `DEPLOY_MODE=full`。

**切換回 full 模式**：於 `.env` 手動改為 `DEPLOY_MODE=full`，`docker compose up -d` 啟動 postgres/redis/minio，再執行 `npm run dev`（bootstrap 一旦見到 `DEPLOY_MODE` 已明確設定，就不會再自動偵測）。local ↔ full 之間沒有數據遷移工具（YAGNI）——`data/local.db` 與 postgres 是兩份獨立數據。
