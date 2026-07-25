# 05 · API 路由（Next.js App Router）

## 規則

- 所有 `/api/**`（除 auth/webhook）經 `withAuth()` wrapper：驗 session → 注入 `userId` → **所有 DB 查詢 where 帶 userId**（唔靠 handler 記得，wrapper 提供 scoped repo/prisma extension）。
- 錯誤統一 `ApiError(code, status, message)`；response envelope `{ok, data} | {ok:false, error:{code,message}}`。
- 變更類 route 自動寫 `audit()`（wrapper 收 `auditAction` 參數）。
- Guard：`route-auth-check` — 掃描所有 route.ts 必須用 withAuth 或明示 `PUBLIC` 標記。

## 路由表（M1）

| Method + Path | 作用 | 觸發任務 |
|---|---|---|
| `POST /api/projects` | 建專案 | — |
| `GET/PATCH/DELETE /api/projects/:id` | 讀/改設定/刪 | — |
| `POST /api/projects/:id/episodes` | 貼原文建集 | `EPISODE_SPLIT`（長文） |
| `GET /api/episodes/:id` | 集詳情（含八站進度聚合 = Next Best Action 數據源） | — |
| `PATCH /api/episodes/:id {autoAdvance:boolean}` | 開關 assisted 自動連跑（`autorun` + `autorunConfig.mode="assisted"`） | — |
| `POST /api/episodes/:id/extract-assets` | ③ 抽角色/場景 | `EXTRACT_ASSETS` |
| `POST /api/characters/:id/generate-image` | 資產生圖（3 張候選） | `IMAGE_CHARACTER` |
| `POST /api/characters/:id/lock` | ✋鎖定資產（揀一張） | — |
| `POST /api/episodes/:id/rewrite-script` | ④ 改寫劇本 | `REWRITE_SCRIPT` |
| `PATCH /api/episodes/:id/script` | 直接編輯劇本文本 | — |
| `POST /api/episodes/:id/storyboard` | ⑤ 切塊+分鏡四階段 | `BUILD_SCENES`→`STORYBOARD_RUN` |
| `POST /api/episodes/:id/storyboard/confirm {authorizeDownstream?:boolean}` | ✋確認分鏡；assisted 模式下 `authorizeDownstream:true` 授權落單金錢站（寫 `autorunConfig.moneyAuthorized`） | — |
| `PATCH /api/shots/:id` | 改單鏡（prompt/分鏡文字） | — |
| `POST /api/shots/:id/generate-image` | ⑥ 單鏡生圖 | `IMAGE_SHOT` |
| `POST /api/shots/:id/generate-video` | ⑦ 單鏡生視頻 | `VIDEO_SHOT` |
| `POST /api/episodes/:id/voice` | 台詞分析 + 全部 TTS | `VOICE_ANALYZE`→`TTS_LINE`×N |
| `POST /api/episodes/:id/compose` | ⑧ 合成導出 | `COMPOSE_EPISODE` |
| `GET /api/tasks?episodeId=&status=failed` | 失敗抽屜 | — |
| `POST /api/tasks/:id/retry` / `cancel` | 重試/取消 | 重入列 |
| `GET /api/sse?projectId=` | SSE 進度流 | — |
| `GET /api/media/sign?key=` | 簽名 URL | — |
| `GET /api/usage?from=&to=&groupBy=` | 用量查詢（M2 出 UI） | — |
| `POST /api/webhooks/:provider` | 廠商回調（驗簽，PUBLIC + secret path） | — |

批量操作（`batch-generate-images` 等）= 前端逐個 POST，server 靠 dedupeKey 天然冪等——M1 唔起批量端點。

`GET /api/projects` 每個 project 附帶 `episodes: {id, episodeNumber, status, updatedAt}[]`（`updatedAt` 供 dashboard「繼續上次」卡片排序用），`orderBy: lastAccessedAt desc`。

## Next Best Action 邏輯（server 計，唔係前端估）

`GET /api/episodes/:id` 回傳 `nextAction: {stage, label, endpoint, blockedBy: […]}`——由 episode 狀態機 + 各站完成度推導（規則寫 `src/lib/next-action.ts` 一個純函數，unit test 全覆蓋）。
