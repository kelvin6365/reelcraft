# 02 · 任務系統（BullMQ + watchdog + SSE）

參考形狀：waoowaoo（簡化——冇事件溯源 Graph run；`tasks` + `task_events` 兩張表就係全部狀態）。

## 佇列

4 條：`rc-text` / `rc-image` / `rc-video` / `rc-voice`。

```ts
defaultJobOptions: { removeOnComplete: 500, removeOnFail: 500, attempts: 1 }
// attempts:1 —— 重試由 app 層話事，BullMQ 只負責派工（見下）
jobId = task.id     // DB task id == BullMQ job id，對帳基礎
```

任務類型 → 佇列路由表（單一 `getQueueForTaskType()`，guard 檢查冇 default fallthrough 落錯隊）：

| 佇列 | 任務類型 |
|---|---|
| rc-text | `EPISODE_SPLIT` `EXTRACT_ASSETS` `REWRITE_SCRIPT` `BUILD_SCENES` `STORYBOARD_RUN` `VOICE_ANALYZE` |
| rc-image | `IMAGE_CHARACTER` `IMAGE_LOCATION` `IMAGE_SHOT` |
| rc-video | `VIDEO_SHOT` `COMPOSE_EPISODE` |
| rc-voice | `TTS_LINE` |

Worker 併發（env 可覆寫）：text 8 / image 10 / video 4 / voice 8。每用戶 in-process 閘 MVP **唔做**（單 worker 容器夠用；SaaS 期改 Redis 分散式閘——到時先寫）。

## 生命週期

```
submitTask(userId, type, target, payload)
  1. dedupeKey = hash(type + targetId + payloadDigest)；撞 UNIQUE → 回傳現有 task（唔重複做）
  2. INSERT tasks(status='queued') → audit('task.submit')
  3. queue.add(jobId=taskId) 失敗 → status='failed', errorCode='ENQUEUE_FAILED'
  4. publish task_events(CREATED) → SSE

worker handler（統一包喺 withTaskLifecycle 內）
  1. 原子搶佔：UPDATE tasks SET status='processing', attempt=attempt+1, startedAt=now()
     WHERE id=? AND status='queued'  — 影響 0 行就 return（已被做/已取消）
  2. 心跳：每 10 秒 UPDATE heartbeatAt
  3. 執行 handler(payload)，進度 reportProgress(0-99) → task_events(PROGRESS) → SSE
  4. 成功：status='completed', progress=100, result → task_events(COMPLETED)
  5. 失敗：classifyError(err) →
     - retryable (429 / timeout / 5xx / ECONNRESET)：attempt < maxAttempts 就
       重新 queue.add（delay = 2000 * 2^attempt + jitter），status 標返 'queued'
     - terminal (內容審查 / 4xx 參數錯 / 模型唔存在)：status='failed' + errorCode
       → 入前端「失敗抽屜」
```

## Watchdog（獨立 process，同 worker 同容器）

每 30 秒一 tick：

1. **孤兒恢復**：`status='queued'` 但 BullMQ 冇對應 job（`queue.getJob(id)` null）→ 重新 add。
2. **殭屍清理**：`status='processing'` 且 `heartbeatAt < now()-90s` → attempt 未超上限就重置 `queued`，超咗就 `failed('WATCHDOG_TIMEOUT')`。
3. 兩個動作都寫 `audit('watchdog.recover'/'watchdog.kill')`。

## SSE 進度

- 單一端點 `GET /api/sse?projectId=`：Redis pub/sub channel `rc:events:{projectId}`，一個共享 subscriber 多工（首個 listener 訂閱、最後一個退訂）。
- 事件格式 `{taskId, type, eventType, progress?, payload?}`。前端斷線重連用 `Last-Event-ID` → 由 `task_events` replay（呢個就係 task_events 存在嘅原因）。
- Guard：`no-polling` —— 前端禁止 setInterval 輪詢任務狀態，一律 SSE。

## 長任務輪詢（provider 側）

fal/AtlasCloud 異步任務：worker 內 `pollExternal(externalId, {intervalMs: 3000, timeoutMs: 600_000})`；provider 有 webhook 就用 webhook，但**一定同時有輪詢兜底**（huobao Vidu 永久卡死嘅教訓）。
