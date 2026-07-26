# 01 · 資料模型（PostgreSQL + Prisma）

鐵律：**每張業務表都有 `userId`**（referencing `users.id`, cascade delete）。全部主鍵為 UUID v7（時序友善）。時間戳使用 `timestamptz`。狀態欄一律使用 `text` + TS union（不使用 DB enum，修改起來較為麻煩）。

## 表清單（15 張）

### Auth 群（Better-Auth 管理）
`users` / `sessions` / `accounts` / `verifications` — 依照 Better-Auth Prisma adapter 的預設 schema，不自行更動。

### 核心域

```ts
projects        id, userId, name, stylePackId, videoRatio('9:16'), videoResolution('720p'),
                modelDefaults jsonb,        // project 層覆寫 { text, image, video, tts }；三層解析見 03-provider-layer.md
                                            // （system 預設 → user_model_defaults 表 → 此處；缺項則落回上層，不會落到 fake）
                inputType,                  // 'novel' | 'script' | 'srt'
                createdAt, updatedAt, lastAccessedAt

episodes        id, userId, projectId, episodeNumber, rawText,           // 原文
                scriptText,                 // ④劇本站產物，可編輯
                status,                     // 'draft'|'assets'|'script'|'storyboard'|'images'|'videos'|'export'|'done'
                exportUrl(mediaId), createdAt, updatedAt
                UNIQUE(projectId, episodeNumber)

scenes          id, userId, episodeId, sceneIndex, summary, content,     // 切塊產物
                anchorStart, anchorEnd,     // 原文錨點（借鑒 waoowaoo：切塊不改寫）
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
                lockedImageMediaId,         // ✋鎖定後才可以放入分鏡
                faceImageMediaId,           // 近臉特寫（使用者手動按「近臉」才生成，非鎖定自動觸發）
                refFaceMediaId, refFaceNote text default '',
                                            // 墊臉——使用者上載的參考臉相＋補充要求；生成候選圖時
                                            // 排第一張 reference（keepIdentity 鎖定圖排第二）
                candidates jsonb, voiceId, locked bool default false

locations       id, userId, projectId, name, summary, prompt,
                lockedImageMediaId, candidates jsonb, locked bool default false,
                angles jsonb default '[]'  // [{label, prompt, mediaId}]——extract_assets v3 判斷
                                            // 重要場景時建議 ≥2 個視角；mediaId 得 IMAGE_LOCATION
                                            // angle 生成分支寫入，PATCH 不可直接指定

voice_lines     id, userId, episodeId, lineIndex, speaker, content,
                characterId, emotion, emotionStrength real default 0.4,  // 上限 0.5
                audioMediaId, matchedShotId,
                UNIQUE(episodeId, lineIndex)
```

### 基建域

```ts
media_objects   id, userId, publicId UNIQUE, storageKey UNIQUE, sha256,
                mimeType, sizeBytes, width, height, durationMs, createdAt
                // DB 其他表只存 mediaId FK；URL 於讀取時經簽名水合

tasks           id, userId, projectId, episodeId, type, targetType, targetId,
                status,                     // 'queued'|'processing'|'completed'|'failed'|'canceled'
                progress int default 0, attempt int default 0, maxAttempts int default 3,
                dedupeKey UNIQUE, payload jsonb, result jsonb, errorCode, errorMessage,
                queuedAt, startedAt, finishedAt, heartbeatAt
                INDEX(status), INDEX(userId, createdAt), INDEX(heartbeatAt)

task_events     id bigserial, taskId, eventType, payload jsonb, createdAt
                INDEX(taskId, id)           // 供 SSE replay 使用

audit_logs      → 見 04-audit.md
ai_call_logs    → 見 04-audit.md
usage_costs     id, userId, projectId, apiType, model, action, quantity, unit,
                cost numeric(18,6), createdAt   // 由 ai_call_logs 聚合寫入
```

## Episode 狀態機（八站對應）

```
draft → assets → script → storyboard → images → videos → export → done
```

- 狀態只可以前進或停留；「返回修改內容」不會使狀態倒退，修改完成後由 UI 提示下游是否需要重新生成（下游資產以 `stale` flag 標示於 shots.status metadata 中）。
- 站點解鎖條件（Next Best Action 卡與進度條皆由此處計算）：
  - `assets` 完成 = 所有 characters/locations `locked=true`
  - `storyboard` 完成 = 所有 scenes 有對應 shots + 用戶按下「確認分鏡」
  - `images` 完成 = 所有 shots.imageMediaId 非空
  - `videos` 完成 = 所有 shots.videoMediaId 非空 + voice_lines 全部有 audioMediaId

## Prisma 慣例

- 表名以 `@@map` 轉為 snake_case（不採用如 `novel_promotion_*` 這種長名，直接使用 `projects`/`shots`）；欄位為 camelCase。
- 主鍵為 `String @id`（UUID v7 由 app 層生成，時序友善）。
- 狀態欄為 `String` + TS union type（不使用 Prisma enum，修改時需要 migration）。
- JSON 欄使用 `Json`；媒體 FK 使用 `mediaId String?` + relation 至 `MediaObject`。
- 原子搶佔／CAS 使用 `updateMany({where: {id, status:'queued'}, data:…})` 並檢查 `count`（此為 waoowaoo 示範的 pattern，即使 Prisma 沒有 row lock 也能做到）。

## 遷移策略

使用 `prisma migrate dev` / `prisma migrate deploy` 進行正式 migration，不採用 huobao 手寫 CREATE TABLE 的方式，也不採用 waoowaoo 在生產環境使用 `db push` 的做法。migration 檔案納入 git 版本控制。
