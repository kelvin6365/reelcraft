# 05 · API 路由（Next.js App Router）

## 規則

- 所有 `/api/**`（除 auth/webhook 外）皆經 `withAuth()` wrapper：驗證 session → 注入 `userId` → **所有 DB 查詢 where 均帶 userId**（不依賴 handler 自行記得，wrapper 提供 scoped repo/prisma extension）。
- 錯誤統一為 `ApiError(code, status, message)`；response envelope 為 `{ok, data} | {ok:false, error:{code,message}}`。
- 變更類 route 自動寫入 `audit()`（wrapper 接收 `auditAction` 參數）。
- Guard：`route-auth-check` — 掃描所有 route.ts，必須使用 withAuth 或明示 `PUBLIC` 標記。

## 路由表（M1）

| Method + Path | 作用 | 觸發任務 |
|---|---|---|
| `POST /api/projects` | 建立專案 | — |
| `GET/PATCH/DELETE /api/projects/:id` | 讀取/修改設定/刪除 | — |
| `POST /api/projects/:id/episodes` | 貼上原文建立集數 | `EPISODE_SPLIT`（長文） |
| `GET /api/episodes/:id` | 集數詳情（含八站進度聚合 = Next Best Action 數據源） | — |
| `PATCH /api/episodes/:id {autoAdvance:boolean}` | 開關 assisted 自動連跑（`autorun` + `autorunConfig.mode="assisted"`） | — |
| `POST /api/episodes/:id/extract-assets` | ③ 抽取角色/場景 | `EXTRACT_ASSETS` |
| `POST /api/characters/:id/generate-image` | 資產生圖（3 張候選）；場景圖跟 `project.videoRatio`、角色圖 9:16 | `IMAGE_CHARACTER` / `IMAGE_LOCATION` |
| `POST /api/characters/:id/lock` | ✋鎖定資產（選擇一張）；不再自動觸發近臉特寫 | — |
| `PATCH /api/characters/:id` | 改 `appearancePrompt` 和／或 `refFaceNote` | — |
| `POST/DELETE /api/characters/:id/ref-face` | 墊臉——multipart 上載／移除參考臉相（jpeg/png/webp ≤10MB，經 MediaObject） | — |
| `PATCH /api/locations/:id` | 改 `prompt`，或以 `{angleIndex, anglePrompt, angleLabel}` 改單條建議視角（`mediaId` 僅由 server 端寫入，不接受 client 指定） | — |
| `POST /api/locations/:id/regenerate {angle?:number}` | 場景候選重生；帶 `angle` 則生成/重生單張視角圖（比例跟 `project.videoRatio`，需已鎖定主圖，否則 `NO_LOCKED_IMAGE`） | `IMAGE_LOCATION` |
| `POST /api/episodes/:id/rewrite-script` | ④ 改寫劇本 | `REWRITE_SCRIPT` |
| `PATCH /api/episodes/:id/script` | 直接編輯劇本文本 | — |
| `POST /api/episodes/:id/storyboard` | ⑤ 切塊+分鏡四階段 | `BUILD_SCENES`→`STORYBOARD_RUN` |
| `POST /api/episodes/:id/storyboard/confirm {authorizeDownstream?:boolean}` | ✋確認分鏡；assisted 模式下 `authorizeDownstream:true` 授權進入下單金錢站（寫入 `autorunConfig.moneyAuthorized`） | — |
| `PATCH /api/shots/:id` | 修改單一鏡頭（prompt/分鏡文字） | — |
| `POST /api/shots/:id/generate-image` | ⑥ 單鏡生圖 | `IMAGE_SHOT` |
| `POST /api/shots/:id/generate-video` | ⑦ 單鏡生視頻 | `VIDEO_SHOT` |
| `POST /api/episodes/:id/voice` | 台詞分析 + 全部 TTS | `VOICE_ANALYZE`→`TTS_LINE`×N |
| `POST /api/episodes/:id/compose` | ⑧ 合成導出 | `COMPOSE_EPISODE` |
| `GET /api/tasks?episodeId=&status=failed` | 失敗抽屜 | — |
| `POST /api/tasks/:id/retry` / `cancel` | 重試/取消 | 重新入列 |
| `GET /api/sse?projectId=` | SSE 進度流 | — |
| `GET /api/media/sign?key=` | 簽名 URL | — |
| `GET /api/usage?from=&to=&groupBy=` | 用量查詢（M2 出 UI） | — |
| `POST /api/webhooks/:provider` | 廠商回調（驗簽，PUBLIC + secret path） | — |

批量操作（`batch-generate-images` 等）= 前端逐個 POST，server 靠 dedupeKey 天然冪等——M1 不建立批量端點。

`GET /api/projects` 每個 project 附帶 `episodes: {id, episodeNumber, status, updatedAt}[]`（`updatedAt` 供 dashboard「繼續上次」卡片排序使用），`orderBy: lastAccessedAt desc`。

## Next Best Action 邏輯（由 server 計算，非前端估算）

`GET /api/episodes/:id` 回傳 `nextAction: {stage, label, endpoint, blockedBy: […]}`——由 episode 狀態機 + 各站完成度推導（規則寫於 `src/lib/next-action.ts` 一個純函數，unit test 全覆蓋）。
