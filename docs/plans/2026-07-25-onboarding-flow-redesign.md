# 新人上手流程重設計 — 引導式建專流＋自動行進

日期：2026-07-25
狀態：設計已驗證（brainstorming 對話逐段確認），未實作
背景：UX deep review（新帳戶全流程 walkthrough + UI code 深讀）發現新人上手同流程中段多處「卡位」。

## 目標用戶（三階段）

1. 而家：自己＋2rocks 同事
2. 近期：客戶／外部短劇創作者試用（唔識技術）
3. 遠期：公開 SaaS

設計以第 2 類為錨：唔識技術嘅創作者要喺第一分鐘內開到工。

## 問題清單（deep review 摘要）

### A 類 — 新人第一分鐘迷路
- **A1** Dashboard 落地係四張全零 metric card，冇「第一步做咩」
- **A2** `餘額 $0.00` 掛喺 header 當眼位但生成照行（billing OFF），令新人以為要充值
- **A3** 新專案 modal 要未貼文就做 4 個決定；畫風包係純文字 dropdown 冇 preview
- **A4** 專案頁「劇集規劃」「新增一集」兩個貼文框並列打對台；AI 模型欄佔右欄黃金位
- **A5** 冇範例內容，time-to-first-success 太長

### B 類 — 流程中段 friction
- **B1** 🐛 `NextActionCard` 嘅 `queued` state 喺 next action 轉變後冇 reset，stale「已排入生成隊列」掛喺新動作下面
- **B2** 同一動作三個入口（站 header／empty state／右欄一鍵執行）
- **B3** 未生成過就叫「重生／重新生成」
- **B4** 冇劇本時已出現「已儲存」disabled 掣
- **B5** 資產圖（新人第一次使錢）冇成本預估冇 confirm —— `estCostUsd`/`pendingUnits` 只 wire 咗 images/videos
- **B6** 分鏡站初始狀態 rail 已顯示「0/1」
- **B7** 計費 card 直出 raw model id；成本 <$0.01 顯示 $0.00 畀人免費錯覺

### C 類 — 資訊架構
- **C1** Episode 頁冇 breadcrumb 返專案
- **C2** 每站「點解要做呢步」零解釋
- **C3** 三套站導航機制（rail／上下站掣／右欄）要自己砌 mental model

### 做得好（保留）
八站 rail 狀態語言（✓／生成中%／🖐待你確認／🔒＋tooltip）、SSE live progress、分鏡確認前下游成本警示、重生/刪除 confirm、失敗卡（去重＋時間＋錯誤引導）。

---

## §1 引導式建專流（Wizard）

「＋新專案」唔再開 modal，直接去 `/projects/new` 全屏三步流。頂部 step indicator（1 貼故事 → 2 揀畫風 → 3 揀出法），可返上一步；中途離開 sessionStorage 存草稿。

**Step 1 貼故事**：一個大 textarea＋字數統計。輔助掣：
- 「📄 用範例小說試下」— 一撳填入 ~800 字範例文，即刻行得（解決 A5）
- 「上載 SRT 字幕」— srt 入口由行為推斷（貼文=novel、上載=srt），「輸入類型」唔再係一條問題
- 超長文（>30k 字）先出分批提示（照舊邏輯）

**Step 2 揀畫風＋比例**：四張真圖卡（每個 style pack 一張代表圖，放 `public/style-previews/`，用各 pack 實際生成樣板）。比例兩個大 toggle：「9:16 直片 · 抖音/Reels」「16:9 橫片 · YouTube」。預設 cinematic-01 + 9:16。

**Step 3 揀出法**：兩張卡 —— 「單集直出」vs「整部規劃」。揀整部先展開規劃選項（秒數/集數/鉤子強度）。專案名放最底細 input，預設自動生成（原文頭 12 字），唔係必答。

**落地**：建 project（+episode 或 plan）→ 直入工作區／規劃審核。專案頁移除兩個貼文框，變純生產儀表板（規劃摘要＋批量面板＋劇集 grid）；AI 模型欄摺做一行入口，進階先展開（解決 A3/A4）。

## §2 自動行進＋檢查點

**核心規則：文字免費站自動串，使錢站必停。**

Episode 加 `autoAdvance: boolean`（預設 true，wizard 帶入；rail 右上 toggle 可熄）。任務完成 lifecycle hook：`autoAdvance` 且下一步係免費文字站（生成劇本→抽取資產→建分鏡）就自動 enqueue —— 重用 batch autorun 嘅 `kickNextStage` 推進邏輯，checkpoint 集唔同（batch＝錢都自動；呢個＝錢必停）。

**三個檢查點**：
1. **揀角色圖** — 抽完資產停喺「生成資產圖 $X.XX」（候選圖已係使錢，附成本，撳咗先出）。出完圖揀圖鎖定。
2. **確認分鏡＋落錢** — 鎖齊資產自動建分鏡（免費），停喺分鏡表＋下游成本警示。確認 dialog 一次過列「圖 $A + 視頻 $B + 配音 $C ≈ 總 $D」，**確認即授權行到尾**（一次知情授權代替逐站三次點擊；想逐站控制就熄 autoAdvance）。
3. **成片預覽** — 合成完停喺 export 站。

**UI**：`NextActionCard` 顯示「⏸ 等緊你：揀角色圖」（checkpoint）／「▶ 自動行進中：第 N 站」（auto）。B5 一併修：資產圖掣接入 `needsCostConfirm`。

## §3 Dashboard 首頁改版

**原則：由管理儀表板變創作起點。**

- **空狀態**：撤四張全零 metric card，得 hero 區 —— 價值主張一句＋大掣「開始製作」（入 wizard）＋「或者用範例小說試下 →」
- **有專案**：頂部「**繼續上次**」card（最近 episode＋卡喺邊個檢查點，一撳直入該站）；之後專案 table。Metrics 縮做一行細 chips。
- **餘額 chip（A2）**：billing mode `OFF` 時完全唔 render（連 header chip）。有 billing 時 chip 撳得去用量/充值。
- **進度可視**：專案 table 加迷你 8 格 station dots 欄（同 rail 同一套狀態色）。

## §4 B 類小修打包

1. **B1**：`NextActionCard` 加 effect —— `nextAction.stage`/`label` 變即 reset `queued`
2. **B2**：EmptyState 保留主掣；右欄喺 `station === nextAction.stage` 時唔出重複掣改「↓ 喺下面操作」；站 header「重新生成」未有內容時隱藏
3. **B3/B4**：未生成過叫「生成」；冇劇本時「已儲存」掣唔 render
4. **B6**：storyboard 未開始時 rail 唔顯示 count
5. **B7**：計費 card 用 `shortModelName()`＋hover 全名；<$0.01 顯示「<$0.01」
6. **C1**：episode header 專案名變 link 返 `/projects/:id`
7. **C2**：`stations.ts` 加 `hint` 欄，station header 下細字顯示一句「呢站做咩＋做完會點」

## 交付切片（一 PR 一薄片）

1. **PR1** §4 全部（純 UI 小修＋B1 bug）— 低風險即出
2. **PR2** §1 wizard
3. **PR3** §3 dashboard
4. **PR4** §2 autoAdvance（動 lifecycle，最後做）

## 唔喺範圍（YAGNI）

- 引導 tour／tooltip walkthrough（wizard＋checkpoint 語言已代替）
- 充值流程（billing ENFORCE 係 M2+）
- 多語 UI
- Episode 工作區大改版（八站 rail 保留原樣）
