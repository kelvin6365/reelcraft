# 04 · Audit 層（硬性要求）

兩張表 + 一個唯一入口 + 一個 guard。目標：**任何動作、任何 AI 呼叫，事後都能查到是誰／何時／用了什麼／花了多少**。

## 表

```ts
audit_logs      id bigserial, userId, at timestamptz default now(),
                action,                  // 'asset.lock' | 'shot.regenerate' | 'episode.export'
                                         // 'settings.change' | 'task.submit' | 'watchdog.recover' …
                targetType, targetId,
                source,                  // 'ui' | 'system' | 'watchdog' | 'agent'(未來)
                metadata jsonb           // before/after 摘要、ip 等
                INDEX(userId, at), INDEX(targetType, targetId)

ai_call_logs    id bigserial, userId, at,
                modelKey,                // 'openrouter::anthropic/claude-sonnet-4.5'
                apiType,                 // text|image|video|tts
                promptId, promptVersion, // prompt 模板溯源（06-prompts.md）
                taskId, projectId, episodeId,
                inputTokens, outputTokens,          // text
                quantity, unit,                     // media：張/秒/字符
                unitPriceSnapshot numeric(18,8), estCostUsd numeric(18,6),
                latencyMs, status,       // 'ok'|'error'
                errorCode, providerRequestId
                INDEX(userId, at), INDEX(taskId), INDEX(modelKey, at)
```

`usage_costs` 是 `ai_call_logs` 的日級聚合（由 cron 每晚執行，或於查詢時 on-the-fly 計算——MVP 階段直接查 ai_call_logs，量大後再物化）。

## 唯一入口

```ts
// src/lib/ai/call-model.ts —— 全 repo 中唯一可以接觸 adapter 的地方
callModel(ctx: {userId, taskId?, promptId?, promptVersion?}, req: TextRequest): Promise<TextResult>
generateMedia(ctx, req: ImageRequest | VideoRequest | TTSRequest): Promise<MediaResult>

// 兩個函數負責：resolve modelKey → 校驗能力目錄 → getProviderKey → 計時
// → 呼叫 adapter → 寫入 ai_call_logs（成功失敗皆寫）→ 回傳
```

寫 log 失敗**不可以**導致主流程失敗（log 使用 fire-and-forget + 本地 console fallback），但要有 metric 得知 log 遺失的情況。

## audit() helper

```ts
audit(userId, action, {targetType, targetId, source='ui', metadata})
```

必須 audit 的動作清單（M1）：`project.create/delete`、`episode.create/export`、`asset.lock/unlock`、
`script.edit`、`storyboard.confirm`、`shot.regenerate`、`task.submit/cancel/retry`、
`settings.change`、`watchdog.*`。由 API route 層執行，不依賴 handler 自律——route wrapper 自動帶入 userId。

## Guard（08-guards.md 之 `no-ai-bypass`）

靜態掃描：`src/lib/ai/adapters/**` 以外不准 import adapter 檔、不准出現 `queue.fal.run` / `openrouter.ai` / AtlasCloud endpoint 字串、不准在 adapter 以外讀取 `FAL_KEY` 等 env。CI fail 代表有人（多數是 AI agent）繞過了入口。

## 用量 UI（M2）

Profile「用量」tab：按日/專案/模型的成本圖、**每集實際花費**、prompt 排行（哪支最耗費 token）、廠商 latency 對比。全部由 `ai_call_logs` 一張表輸出。
