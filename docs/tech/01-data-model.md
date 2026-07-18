# 01 · 資料模型（PostgreSQL + Prisma）

鐵律：**每張業務表都有 `userId`**（referencing `users.id`, cascade delete）。全部主鍵 UUID v7（時序友善）。時間戳用 `timestamptz`。狀態欄一律 `text` + TS union（唔用 DB enum，改起上嚟煩）。

## 表清單（15 張）

### Auth 群（Better-Auth 管理）
`users` / `sessions` / `accounts` / `verifications` — 照 Better-Auth Prisma adapter 預設 schema，唔自己作。

### 核心域

```ts
projects        id, userId, name, stylePackId, videoRatio('9:16'), videoResolution('720p'),
                modelDefaults jsonb,        // { text:'openrouter::…', image:'fal::…', video:'fal::…', tts:'fal::…' }
                inputType,                  // 'novel' | 'script' | 'srt'
                createdAt, updatedAt, lastAccessedAt

episodes        id, userId, projectId, episodeNumber, rawText,           // 原文
                scriptText,                 // ④劇本站產物，可編輯
                status,                     // 'draft'|'assets'|'script'|'storyboard'|'images'|'videos'|'export'|'done'
                exportUrl(mediaId), createdAt, updatedAt
                UNIQUE(projectId, episodeNumber)

scenes          id, userId, episodeId, sceneIndex, summary, content,     // 切塊產物
                anchorStart, anchorEnd,     // 原文錨點（學 waoowaoo：切塊唔改寫）
                UNIQUE(episodeId, sceneIndex)

shots           id, userId, episodeId, sceneId, shotIndex,
                storyboardJson jsonb,       // 分鏡四階段合併結果（景別/運鏡/表演/攝影）
                imagePrompt, imageMediaId, imageCandidates jsonb,        // 3 選 1
                videoPrompt, videoMediaId,
                status,                     // per-asset: 'pending'|'generating'|'ready'|'failed'
                durationMs, linkedToNext bool,
                UNIQUE(episodeId, shotIndex)

characters      id, userId, projectId, name, aliases jsonb, profile text,
                appearancePrompt,           // 出圖用外貌描述
                lockedImageMediaId,         // ✋鎖定後先可以入分鏡
                candidates jsonb, voiceId, locked bool default false

locations       id, userId, projectId, name, summary, prompt,
                lockedImageMediaId, candidates jsonb, locked bool default false

voice_lines     id, userId, episodeId, lineIndex, speaker, content,
                characterId, emotion, emotionStrength real default 0.4,  // 上限 0.5
                audioMediaId, matchedShotId,
                UNIQUE(episodeId, lineIndex)
```

### 基建域

```ts
media_objects   id, userId, publicId UNIQUE, storageKey UNIQUE, sha256,
                mimeType, sizeBytes, width, height, durationMs, createdAt
                // DB 其他表只存 mediaId FK；URL 讀取時經簽名水合

tasks           id, userId, projectId, episodeId, type, targetType, targetId,
                status,                     // 'queued'|'processing'|'completed'|'failed'|'canceled'
                progress int default 0, attempt int default 0, maxAttempts int default 3,
                dedupeKey UNIQUE, payload jsonb, result jsonb, errorCode, errorMessage,
                queuedAt, startedAt, finishedAt, heartbeatAt
                INDEX(status), INDEX(userId, createdAt), INDEX(heartbeatAt)

task_events     id bigserial, taskId, eventType, payload jsonb, createdAt
                INDEX(taskId, id)           // SSE replay 用

audit_logs      → 見 04-audit.md
ai_call_logs    → 見 04-audit.md
usage_costs     id, userId, projectId, apiType, model, action, quantity, unit,
                cost numeric(18,6), createdAt   // 由 ai_call_logs 聚合寫入
```

## Episode 狀態機（八站對應）

```
draft → assets → script → storyboard → images → videos → export → done
```

- 狀態只可以前進或者停留；「返轉頭改嘢」唔倒退狀態，改完由 UI 提示下游要唔要重生（下游資產標 `stale` flag 喺 shots.status metadata 度）。
- 站點解鎖條件（Next Best Action 卡同進度條都由呢度計）：
  - `assets` 完成 = 所有 characters/locations `locked=true`
  - `storyboard` 完成 = 所有 scenes 有對應 shots + 用戶撳咗「確認分鏡」
  - `images` 完成 = 所有 shots.imageMediaId 非空
  - `videos` 完成 = 所有 shots.videoMediaId 非空 + voice_lines 全部有 audioMediaId

## Prisma 慣例

- 表名 `@@map` snake_case（`novel_promotion_*` 呢種長名唔要，直接 `projects`/`shots`）；欄位 camelCase。
- 主鍵 `String @id`（UUID v7 由 app 層生成，時序友善）。
- 狀態欄 `String` + TS union type（唔用 Prisma enum，改起上嚟要 migration）。
- JSON 欄用 `Json`；媒體 FK 用 `mediaId String?` + relation 去 `MediaObject`。
- 原子搶佔／CAS 用 `updateMany({where: {id, status:'queued'}, data:…})` 檢查 `count`（waoowaoo 示範嘅 pattern，Prisma 冇 row lock 都做到）。

## 遷移策略

`prisma migrate dev` / `prisma migrate deploy` 正式 migration，唔學 huobao 手寫 CREATE TABLE、唔學 waoowaoo 生產環境 `db push`。migration 檔入 git。
