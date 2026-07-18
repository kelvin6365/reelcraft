# 07 · 部署（docker-compose 單 VPS）

## 拓撲（六個 service）

```yaml
services:
  app:       # next start（只有 web，冇 worker —— 同 waoowaoo 單容器綁定劃清界線）
  worker:    # tsx src/workers/index.ts + watchdog（同一容器兩個 process，tini 管）
  postgres:  # postgres:17-alpine，volume pg_data
  redis:     # redis:7-alpine --appendonly yes，volume redis_data
  minio:     # minio/minio，volume minio_data（上線可換 R2，改 env 就得）
  ffmpeg 由 worker 鏡像內建（apk add ffmpeg）——COMPOSE_EPISODE 喺 worker 度跑
```

- `app` `depends_on` postgres/redis healthy；`worker` 再加 minio。
- migrate：`app` 啟動 command 先 `prisma migrate deploy` 再 `next start`（唔准 db push）。
- 反向代理：Caddy 喺 host 層（自動 HTTPS），`/` → app:3000。Bull Board M2 先加（掛 `/admin/queues` + basic auth）。

## Dockerfile

- app：三段式 `node:22-alpine`（deps → build（prisma generate + next build）→ runner），runner 唔留 devDeps。
- worker：同一 base，多 `ffmpeg`；入口 `tsx`（worker code 唔使 build）。
- 兩個 image 一個 repo 兩個 target（`--target app` / `--target worker`）。

## Env vars（.env.example 必須同步維護，guard 驗齊）

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

規則：**env 只喺 `src/lib/env.ts` 讀一次**（zod 驗證，缺即啟動 fail-fast）；其他檔案 import env object。Guard 掃 `process.env.` 出現喺 env.ts 以外。

## 啟動順序 / 健康檢查

- `GET /api/health`：DB ping + Redis ping + storage head-bucket → `{ok, checks}`。
- compose healthcheck 全部 service 有；worker 健康 = watchdog 心跳檔案 mtime < 60s。

## 備份

- postgres：每晚 `pg_dump` 去 storage bucket `backups/`（cron 喺 worker 容器）。
- MinIO data volume 自己係媒體真身——上 R2 之後呢層冇單點。
