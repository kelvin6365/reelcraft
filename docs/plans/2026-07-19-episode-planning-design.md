# AI 劇集規劃（Episode Planning）設計

> 日期：2026-07-19｜作者：Kelvin + Claude（brainstorming，product-designer lens）
> 狀態：已確認設計，未開工
> 依賴：M0–M3 已出貨。半數基建已存在（見下）。

## 0. 問題與目標

現況：用戶要**逐集手動貼原文**建立 Episode。真實用戶（短劇/網劇創作者）通常拿住一部長篇小說，最痛的是「唔知應該切幾多集、每集喺邊度斷、每集有冇鉤子」。

目標：貼成本小說 → 設一個目標 → **AI 切集並自評風險** → 用戶只審亮燈嗰幾集 → 確認生成 → 點入單集行現有八站。

### 已存在的基建（呢個 feature 係「駁線」多過「從零起」）
- `TASK_TYPE.EPISODE_SPLIT`（handler 現時掉 `NOT_IMPLEMENTED`）
- `prompts/pipeline/episode_split.zh.txt`（已寫）
- `EpisodeSplitOutput` schema：`episodes[]{index, title, startAnchor, endAnchor, summary, hook}`
- `sliceByAnchors()`（錨點切分，唔改寫原文）
- 成本預覽 + 重複偵測（M3）、失敗抽屜 + 一鍵重試、canary 迴歸

## 1. 決策記錄（brainstorm 結論）

| 問題 | 決定 |
|---|---|
| 集數規模 | **兩種都要，用戶自定**（短劇 60-100 微集 / 網劇 8-16 集）。平台唔假設每集長度。 |
| 用戶控制 | 每集長度、總集數、鉤子/節奏、題材/畫風——但**唔擺四個平等旋鈕**（見 §3 輸入設計） |
| 審核行為 | **靠例外審核（review by exception）**：AI 自評風險，用戶只睇亮燈嗰幾集，唔逐集深審 |

## 2. 使用者流程

```
建項目（揀題材/畫風 = stylePackId）
  └→【新】劇集規劃頁
        ① 貼成本小說原文
        ② 設目標：主錨點二選一 —「每集約 90 秒」或「總共 12 集」
        ③ AI 規劃 → 集卡列，每張：標題 · 摘要 · 原文預覽 · 鉤子 · 🟢/🟡/🔴 風險
        ④ ✋審核（靠例外）：🔴🟡 置頂集中處理；🟢 摺疊一鍵接受
        ⑤ 確認 → 錨點切分批量建 N 個 Episode（rawText 已入）
  └→ 點入任一集 → 現有八站流程（不變）

舊路保留：純手動「新增一集」仍在（短片/單段用戶不強制規劃）
```

## 3. 輸入設計（三層，唔嚇窒用戶）

- **主錨點（揀一個，唔逼兩個都填）**：「每集約 __ 秒」**或**「總共 __ 集」。定一個 → AI 推導另一個並顯示（「90 秒/集 → 估 14 集」）。兩個同時填會衝突。
- **傾向（可選，全局）**：鉤子強度 chip（短劇預設「強」）、節奏鬆↔緊。唔係逐集旋鈕。
- **繼承（唔喺呢頁問）**：題材/畫風 = 項目級 `stylePackId`，建項目時已揀。
- **成本預覽**：出結果即顯示「14 集 · 全做估 ~$X · 可先做 3 集試水」。
- **YAGNI**：唔做逐集自訂長度；微調靠審核步驟改邊界。

## 4. 風險標記系統（「靠例外審核」的引擎）

AI 切集**同一次呼叫**順手自評，零額外成本。

**三燈**：🟢 穩（摺疊）/ 🟡 建議睇 / 🔴 有問題。

**六種風險旗**（每集可多個，附一句人話原因）：

| 旗 | 觸發 | 一鍵修復 |
|---|---|---|
| `weak_hook` | 結尾冇 cliffhanger（短劇頭號殺手） | 併落一集 / 重切邊界 |
| `too_long` / `too_short` | 偏離目標長度 >40% | 拆 / 併相鄰 |
| `low_density` | 水集，劇情推進少 | 併入前後 |
| `mid_scene_cut` | 切喺場景/對話中間 | 移邊界 |
| `dialogue_overflow` | 單集對白爆多，塞唔落目標長度 | 拆集 |

**Schema 擴充**：`EpisodeSplitOutput.episodes[]` 加 `risk: {level: 'ok'|'review'|'problem', flags: string[], note: string}`。

**UI 用「例外」**：頂部「14 集 · 🔴2 · 🟡3 · 🟢9」+「只顯示要處理」開關（預設開）。🔴🟡 置頂展開，🟢 摺成一行。每個旗係**可點的建議**（撳 `weak_hook` 上的「併落一集」直接執行）。用戶工作由「審 80 集」變「解決 5 個亮燈提示」。

## 5. 技術落地

**資料模型（加最少，不另起 Series）**
- `Project` 加：`sourceText`（全本）、`planStatus`（`none|planning|planned`）、`planConfig`（Json）、`planResult`（Json：集卡陣列連風險，**未確認前唔建 Episode**）。

**EPISODE_SPLIT handler**（實作）
- 讀 `sourceText` + `planConfig` → `buildPrompt("episode_split")` → `textCallJson`（帶重試+schema 驗證）→ 寫 `project.planResult`（唔直接建集）。

**超長小說**（網文 10 萬字常態）
- v1：單次規劃 cap（≤ 25 集）+ 提示分批。
- v2：兩階段（弧線粗切 → 每段細切，BullMQ 並發）。

**確認 → 建集**
- `POST /api/projects/:id/plan/confirm`：交易內 `createMany` Episode，`rawText` 由 `sliceByAnchors` 切，`status='draft'`。用成本預覽 + 重複偵測（重新規劃前警告會清走未開工的集）。

**一鍵修復後端**
- 併/拆/移邊界 = 純 `planResult` 陣列操作 + 重新錨點切，**唔再呼叫 AI**（除「重新規劃單集」）。平、快、即時預覽。

**API**
- `PATCH /api/projects/:id`（加 `sourceText`）
- `POST /api/projects/:id/plan`（設 config，觸發 EPISODE_SPLIT）
- `PATCH /api/projects/:id/plan`（併/拆/移邊界/改標題/刪，操作 planResult）
- `POST /api/projects/:id/plan/confirm`（建集）

## 6. 引導整合 + 失敗處理

- 規劃係**項目級**，八站之上。層次：`項目 → 規劃 → [每集八站]`。八站不改。
- 項目頁 Next Best Action：未規劃→「AI 規劃分集」；已規劃→「點入第 1 集開始」。
- 失敗：規劃是 `EPISODE_SPLIT` task → 入失敗抽屜、可重試；壞 JSON 靠 `textCallJson` 2 次自我修正；錨點搵唔到靠 `sliceByAnchors` 比例 fallback。

## 7. 測試 / 驗收

- 單元：錨點切分（含 fallback）、風險旗規則、planResult 併/拆/移邊界操作。
- Canary：`episode_split` 黃金樣本（固定小說 → 集數範圍 + 每集有 hook + risk 欄齊）。
- E2E `scripts/smoke-plan.ts`：貼小說 → 規劃 → 斷言 N 集連風險旗 → 確認 → 斷言建咗 N 個 Episode、rawText 非空 → 第 1 集跑得八站。
- **收貨**：貼一部多章小說 + 一個目標，30 秒內出帶三燈的集卡；只處理亮燈集就 confirm 到；生成的集直接可入八站出片。

**份量**：約一個 M1 薄片（1 handler + 4 route + 1 項目頁規劃 UI + schema 擴充）。
