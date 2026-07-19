# 部署指南（單 VPS）

## 前置

- 一部 VPS（2 vCPU / 4GB 起），裝好 Docker + compose plugin
- 一個域名指向 VPS（Caddy 自動 HTTPS）

## 步驟

```bash
git clone <repo> && cd reelcraft
cp .env.example .env.prod
```

`.env.prod` 必改項：

| 變數 | 說明 |
|---|---|
| `DATABASE_URL` | `postgresql://reelcraft:<POSTGRES_PASSWORD>@postgres:5432/reelcraft` |
| `REDIS_URL` | `redis://redis:6379` |
| `STORAGE_TYPE` | `s3` |
| `STORAGE_ENDPOINT` | `http://minio:9000`（或 Cloudflare R2 endpoint） |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | 自訂強密碼 |
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32` |
| `BETTER_AUTH_URL` | `https://你嘅域名` |
| `API_ENCRYPTION_KEY` | `openssl rand -hex 32`（BYO-Key 加密，改咗舊 key 即全部失效） |
| `POSTGRES_PASSWORD` | compose 用 |
| `BILLING_MODE` | `SHADOW`（內部）或 `ENFORCE`（收費） |
| provider keys | 平台代付模式先填；純 BYO-Key 可留空 |
| `MODEL_DEFAULTS_PRESET` | **生產留空**（系統預設 = 真模型）；只有 dev/CI 冇 key 先設 `fake` |

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Caddy（host 層）：

```
你嘅域名 {
    reverse_proxy localhost:3000
}
```

## 運維

- **健康**：`GET /health` → `{ok, checks}`（實際係 `/api/health`）
- **充值**（ENFORCE 模式）：`docker compose exec worker npx tsx scripts/recharge.ts <email> <amountUsd>`
- **備份**：`docker compose exec postgres pg_dump -U reelcraft reelcraft > backup.sql`（建議 cron 每晚）
- **升級**：`git pull && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`（app 啟動時自動 `migrate deploy`）
- **水平擴 worker**：`docker compose -f docker-compose.prod.yml up -d --scale worker=3`（配額閘係 Redis 分散式，多副本安全）

## R2 代替 MinIO（慳運維）

`STORAGE_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com`，key 用 R2 API token，compose 刪走 minio service。媒體簽名 URL 自動走公網。
