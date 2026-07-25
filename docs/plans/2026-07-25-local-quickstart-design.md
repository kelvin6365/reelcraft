# Local Quick Start — 零 Docker 一條命令起動

日期：2026-07-25
狀態：設計已驗證（brainstorming 逐段確認），未實作
背景：public repo 而家 quickstart 要 6 步、兩個 terminal、Docker infra。目標係好似其他 open source 咁：`npm install && npm run dev` 一條命令，本機零外部依賴行到全功能。

## 定位

Local mode 係**一等公民**（單人完整用）：真 model key 出真片、全功能可用；Redis 依賴嘅橫向擴展類功能降級做單機版。Docker/Postgres 係多人／部署先需要。

**可行性已驗證**：
- Storage 層已有 driver 抽象（`src/lib/storage/index.ts` 按 `STORAGE_TYPE` 揀 local/s3，`.env.example` 預設已係 `local`）— MinIO 預設根本唔使。
- Prisma 6.19 + SQLite + `Json` + `Decimal` schema validate 通過；只需除去 16 個 `@db.Decimal(...)` postgres 原生註解。
- Redis 用喺 5 度：BullMQ queue、SSE pubsub（`task/events.ts`）、並發配額（`quota/gate.ts`）、每日配額（`quota/daily.ts`）、rate-limit（`api/rate-limit.ts`）。

## §1 模式與自動偵測

兩個模式一個掣：`DEPLOY_MODE=full | local`。

`npm run dev` 嘅 predev bootstrap：
1. 冇 `.env` → 由 `.env.example` 建立。
2. `DEPLOY_MODE` 已明確設定 → 尊重（唔會偷偷轉模式搬數據）。
3. 未設 → 探測：`DATABASE_URL` 嘅 Postgres 3 秒 ping 唔通或未設 → 揀 `local`，**寫死入 `.env`** 並印提示（想完整版：`DEPLOY_MODE=full` + `docker compose up -d`）；ping 通 → `full`。
4. local 模式冇 model key 又冇 preset → 自動寫 `MODEL_DEFAULTS_PRESET=fake`＋提示。

偵測結果寫死入 `.env` 係刻意嘅：模式一經選定固定，轉模式必須用戶明確改，防止「docker 開咗就靜靜轉 postgres、SQLite 數據唔見」。

數據落腳：`data/local.db`＋現有 `data/storage/`（`.gitignore` 已包 `/data/`）。`rm -rf data` = 全新開始。

## §2 DB 層：一份 schema 兩個 provider

- 真相來源 = `prisma/schema.prisma`（postgres）。`scripts/gen-sqlite-schema.mjs` 機械生成 `prisma/schema.sqlite.prisma`：datasource 換 sqlite＋除去 `@db.*` 註解＋AUTO-GENERATED 頭；**checked in**。
- 新 guard `scripts/guards/sqlite-schema-sync.mjs`：CI 驗證 generated 檔同 source 同步（鐵律 8）。
- Migrations：postgres 照舊 `prisma migrate`；SQLite 用 **`prisma db push`**（單人本機唔需要 migration 歷史；破壞性變更 bootstrap 印警告）。
- Client：predev 按模式揀 schema `prisma generate`，同一個 `@prisma/client` 出口，app code 零改動。
- 已知限制寫入文檔：SQLite 並發較弱，但 task claim guard（`updateMany where status:queued` 樂觀鎖）單機夠用。

## §3 Redis 替身：local = 單一 process

用 `getStorage()` 嗰套 driver-selection 模式（memoized、按 `DEPLOY_MODE` 揀）：

1. **Worker 內嵌**：local 唔行 `npm run worker` — Next `instrumentation.ts` 喺 web process 起 DB poller loop：每 ~1s 查 `Task where status="queued"`，現有 claim guard 搶 task，跑現有 handler registry（handlers 零改動）。並發 in-process 上限；delayed re-enqueue 用 `setTimeout`。
2. **Queue driver**：`task/queues.ts` `addTaskJob`/`isJobAlive` 分流 — full → BullMQ 照舊；local → row 標 queued（poller 執）、`isJobAlive` 實測 in-process poller。
3. **SSE pubsub**：`events.ts` in-process `EventEmitter` driver，同一 publish/subscribe 簽名。
4. **Quota / rate-limit**：`quota/gate.ts`、`quota/daily.ts`、`api/rate-limit.ts` in-memory Map 版（單 process 語義正確；重啟歸零，文檔註明）。
5. **Full 模式都受惠**：`npm run dev` full 模式用 `concurrently` 一 terminal 齊起 web＋worker（兩色 log）；`npm run worker` 保留畀分開行/scale。

## §4 體驗、驗證、切片

最終體驗：
```bash
git clone … && cd reelcraft
npm install
npm run dev     # 就係咁多 — bootstrap 逐項 ✔，單 process，fake preset 出到片
```

驗證：
1. 單元：queue driver 分流、in-memory quota/rate-limit、gen-sqlite-schema transform。
2. `npm run smoke:pipeline` 加 `DEPLOY_MODE=local` 變體（SQLite 小說→mp4 全程 E2E）。
3. `sqlite-schema-sync` guard 入 CI；現有 12 guards＋全部測試照過。
4. 手動：`rm -rf data && npm run dev` 零開始出片；full 模式零迴歸（BullMQ 路徑唔郁）。

交付切片：
1. **PR-A** `concurrently` 一 terminal（web＋worker）＋predev bootstrap 骨架
2. **PR-B** SQLite schema 生成＋guard＋db push bootstrap
3. **PR-C** Redis 替身 drivers＋內嵌 worker
4. **PR-D** 自動偵測收官＋smoke local 變體＋README/docs 更新

唔喺範圍（YAGNI）：local→full 數據遷移工具、devcontainer、Electron、多用戶 local。
