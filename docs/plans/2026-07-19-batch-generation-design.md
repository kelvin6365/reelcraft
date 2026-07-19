# 批量出片（Batch / Season Generation）設計

> 日期：2026-07-19｜狀態：已確認
> 目標：規劃完 N 集後一鍵全季生成，唔使逐集手動行八站。短劇 60-100 集嘅量產核心。

## 核心設計：重用 Next Best Action 做批量引擎

唔另起 orchestrator 任務（會長期霸佔 worker slot）。改為 **auto-advance hook**：

```
task 完成（lifecycle）→ 若該 episode 開咗 autorun：
  computeNextAction(episode)  ← 現成狀態機
    → 有 endpoint 對應 task？submit 佢（繼續鏈）
    → 係審核閘？按批量選項自動過 或 暫停亮燈
    → 已完成？autorun 結束
```

- 引擎 = 現有 `computeNextAction`（已有 12 個單元測試），零新狀態機。
- 每步都係普通 task → 佇列/配額/預算護欄/失敗抽屜全部自動生效。
- 失敗：task 入失敗抽屜，autorun 停喺該站；一鍵重試後自動繼續（advance hook 照跑）。

## 審核閘策略（批量選項）

| 閘 | 批量做法 |
|---|---|
| 資產鎖定 | **前置條件**：批量開始前 project 資產必須已鎖（資產係 project 級，鎖一次全季用）。未鎖 → 批量掣 disabled 並提示。 |
| 分鏡確認 | 選項 `autoConfirmStoryboard`（預設 ON）：自動確認並記 audit；OFF 則該集停喺分鏡站亮燈等人手。 |
| 成本 | 開始前顯示全季成本預估（重用 estimateDownstreamCost × N 集）；project budgetUsd 照樣把關。 |
| 跳視頻（省錢模式） | 選項 `skipVideo`（預設 OFF）：ON 則 images 完成後跳過 VIDEO_SHOT 直接 voice→compose（compose 已有靜態圖 fallback）。 |

## 實作

1. **schema**：`Episode.autorun Boolean @default(false)` + `Episode.autorunConfig Json`（{autoConfirmStoryboard, skipVideo}）。
2. **advance engine** `src/lib/batch/advance.ts`：`advanceEpisode(episodeId)` — build snapshot → computeNextAction → map action→submitTask（同 API route 一一對應嘅 mapping 表）；審核閘按 config 處理（auto-confirm = 直接 update status + audit）。冪等（dedupeKey 天然防重複）。
3. **lifecycle hook**：task completed 且有 episodeId 且 episode.autorun → `advanceEpisode`（fire-and-forget + catch log；hook 失敗唔影響 task 本身）。
4. **API**：`POST /api/projects/:id/batch {episodeIds?, autoConfirmStoryboard, skipVideo}` → 逐集 set autorun + kick advanceEpisode；`DELETE` = 停（清 autorun flags）。
5. **UI**：專案頁「🚀 批量生成全季」掣 + 選項 modal（成本預估、跳視頻、自動確認分鏡）+ **全季進度板**（每集一行：八站 chips + 目前站 + 失敗亮燈）。
6. **skipVideo**：advance mapping 見 videos stage 且 config.skipVideo → 跳去 voice。

## 測試/驗收

- 單元：advance mapping（每個 nextAction → 正確 task type）、審核閘 auto/pause、skipVideo 跳站。
- E2E `smoke-batch.ts`：fake providers，規劃 2 集 → 批量開始 → 兩集全自動行到 exportMediaId，零人手介入。
- 收貨：Web 一撳，N 集自動出晒片；中途 kill worker 恢復後繼續（watchdog + advance 冪等）。
