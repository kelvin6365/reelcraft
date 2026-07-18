# 04 · Audit 層（硬性要求）

兩張表 + 一個唯一入口 + 一個 guard。目標：**任何動作、任何 AI 呼叫，事後都查到邊個/幾時/用咗乜/使咗幾多**。

## 表

```ts
audit_logs      id bigserial, userId, at timestamptz default now(),
                action,                  // 'asset.lock' | 'shot.regenerate' | 'episode.export'
                                         // 'settings.change' | 'task.submit' | 'watchdog.recover' …
                targetType, targetId,
                source,                  // 'ui' | 'system' | 'watchdog' | 'agent'(將來)
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

`usage_costs` 係 `ai_call_logs` 嘅日級聚合（cron 每晚跑，或者查詢時 on-the-fly——MVP 直接查 ai_call_logs，量大先物化）。

## 唯一入口

```ts
// src/lib/ai/call-model.ts —— 全 repo 唯一可以掂 adapter 嘅地方
callModel(ctx: {userId, taskId?, promptId?, promptVersion?}, req: TextRequest): Promise<TextResult>
generateMedia(ctx, req: ImageRequest | VideoRequest | TTSRequest): Promise<MediaResult>

// 兩個函數負責：resolve modelKey → 校驗能力目錄 → getProviderKey → 計時
// → 呼叫 adapter → 寫 ai_call_logs（成功失敗都寫）→ 回傳
```

寫 log 失敗**唔可以**令主流程 fail（log 用 fire-and-forget + 本地 console fallback），但要有 metric 知道 log 掉咗。

## audit() helper

```ts
audit(userId, action, {targetType, targetId, source='ui', metadata})
```

必 audit 動作清單（M1）：`project.create/delete`、`episode.create/export`、`asset.lock/unlock`、
`script.edit`、`storyboard.confirm`、`shot.regenerate`、`task.submit/cancel/retry`、
`settings.change`、`watchdog.*`。API route 層做，唔靠 handler 自律——route wrapper 自動帶 userId。

## Guard（08-guards.md 之 `no-ai-bypass`）

靜態掃描：`src/lib/ai/adapters/**` 以外唔准 import adapter 檔、唔准出現 `queue.fal.run` / `openrouter.ai` / AtlasCloud endpoint 字串、唔准 adapter 以外讀 `FAL_KEY` 等 env。CI fail = 有人（多數係 AI agent）繞過咗入口。

## 用量 UI（M2）

Profile「用量」tab：按日/專案/模型成本圖、**每集實際使費**、prompt 排行（邊支食 token 最多）、廠商 latency 對比。全部由 `ai_call_logs` 一張表出。
