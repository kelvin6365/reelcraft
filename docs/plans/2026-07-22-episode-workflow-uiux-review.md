# 八站工作流 UIUX 審查與重設計

> 日期：2026-07-22 · 範圍：`/projects/[id]/episodes/[episodeId]`（單集工作區，八站引導流程）
> 相關：`docs/plans/2026-07-18-reelcraft-mvp-design.md` §1（三件貫穿全程嘅 UX 固定件）

## 0. 審查對象

| 檔案 | 行數 | 角色 |
|---|---|---|
| `src/app/projects/[id]/episodes/[episodeId]/page.tsx` | 165 | 版面組裝 + 成本卡 |
| `src/ui/episode/panels.tsx` | 854 | 八站全部面板 |
| `src/ui/episode/PipelineBar.tsx` | 87 | 頂部進度總覽條 |
| `src/ui/episode/NextActionCard.tsx` | 66 | Next Best Action 卡 |
| `src/ui/episode/FailureDrawer.tsx` | 153 | 失敗抽屜（右下紅 FAB） |
| `src/ui/episode/useEpisode.ts` | 115 | 資料 + SSE + stalled 偵測 |
| `src/ui/episode/stations.ts` | 22 | 八站定義 + scrollToStation |

## 1. 現況架構

```
AppShell
 └ 標題 + status badge（raw enum）
 └ PipelineBar（8 個圓點，click = scrollIntoView）
 └ [stalled 橫幅]
 └ 2 欄 grid
     ├ 主欄：8 個 Card 全部同時 mount、永遠展開
     └ 側欄 sticky：下一步卡 + 成本卡
 └ 右下角紅色 FAB：失敗任務
```

**核心病灶**：呢個唔係「引導式八站工作流」，係「一版八張卡嘅長卷」。導航條只做 scroll，唔做狀態；
用戶永遠見到 8 站嘅全部內容，但冇任何一刻知道「而家輪到我做乜、邊度卡住」。
設計文檔要解決嘅 Toonflow 痛點「唔知下一步」，喺實作上只做咗一半。

## 2. 問題表

| # | 嚴重度 | 問題 | 證據 | 點解差 | 重設計 |
|---|---|---|---|---|---|
| 1 | 🔴 | **八站全部同時展開**，無焦點。20 鏡嘅一集會同時 mount 40+ textarea、40 個媒體格 | `page.tsx:92-99` | 引導模式最重要係「一次只做一件事」。長卷 = 用戶要滾 3-5 屏先搵到當前站；performance 亦炸 | 改 **一次一站工作區**：rail 切站，內容區只 render 當前站（`?station=images` 入 URL，可分享／後退）。相鄰站用 prev/next 掣 |
| 2 | 🔴 | 文案叫用戶「用**右下角**『下一步』」，但右下角其實係紅色「失敗任務」FAB，下一步卡喺右上側欄 | `panels.tsx:118,304,446,525,793,850` vs `page.tsx:102`、`FailureDrawer.tsx:78` | 直接指錯位置，係 copy bug。新用戶第一件事就搵唔到主 CTA | 空狀態改成**內嵌 CTA 掣**（`生成資產圖 ~$0.60`），唔再指方向；「下一步」定位成 sticky action bar |
| 3 | 🔴 | `nextAction.blockedBy` 有資料但 UI **完全冇 render**；設計文檔要求「鎖住嘅站 hover 顯示還差什麼」 | `types.ts:16`、全頁無引用 | 「唔知下一步」正正係文檔要解決嘅痛點，而依家未解 | Rail 上未解鎖站 = 灰 + 鎖圖示，hover/focus 彈「仲差：① 鎖定 3 個角色 ② 確認分鏡」，每項可點擊直達 |
| 4 | 🔴 | **成本確認方向反轉**：單鏡重生（~$0.05）要 ConfirmDialog；「一鍵執行」批量生 18 張圖（~$1+）零確認 | `panels.tsx:707` vs `NextActionCard.tsx:39` | 貴 20 倍嘅操作反而冇閘 | 統一 `CostConfirm`：門檻制（>$0.50 或 >5 unit 先彈），細額直接跑。所有破費入口共用同一個組件 |
| 5 | 🟠 | 兩個**審核點**（資產鎖定、分鏡確認）視覺上同其他站一模一樣，「確認分鏡」係 header 右邊細掣 | `panels.tsx:512-519` | 全流程得兩個 human gate，係最重要嘅兩粒掣，而家最唔顯眼 | 審核站專屬語言：琥珀 accent border + rail 上 ✋ 標記 + **sticky 底部 action bar**（確認分鏡 = primary 大掣） |
| 6 | 🟠 | 毀滅性「🔄 重新生成分鏡」（清走所有已生成圖／視頻）同「確認分鏡」**貼隔籬**，兩粒都係細掣，前者用 outline 色 | `panels.tsx:483-519` | 誤撳成本 = 成集重做 + 已花費不退 | 拆走：確認留 action bar；重新規劃收入 header「⋯」選單，標紅字 + 保留現有 ConfirmDialog |
| 7 | 🟠 | **圖像站同視頻站係兩個獨立 grid**，同一鏡 #5 嘅圖同片要跨屏對照 | `panels.tsx:743-785` | 用戶心智單位係「鏡頭」，唔係「媒體類型」 | 合併成**鏡頭台**：一鏡一行 → 縮圖｜影片｜prompt｜狀態｜動作。圖／視頻做 tab filter 而唔係分站（rail 仍顯示兩站進度） |
| 8 | 🟠 | 圖像／視頻站**零批量操作** — 20 鏡撳 20 次 | `panels.tsx:603-623` | 量產工具嘅致命傷（目標係 60-100 集） | 工具列：全選／只選未生成／只選失敗 → 「生成選取 12 鏡 ~$0.84」。逐格掣保留做例外操作 |
| 9 | 🟠 | **三種唔同儲存模型**：資產 prompt = onBlur 自動存；劇本 = 手動掣 + dirty 態；分鏡 prompt = onBlur 但 `refetch:false` **零回饋** | `panels.tsx:200`、`413-421`、`582/592` | 用戶學唔到規則，最差係分鏡 — 改完唔知有冇存到 | 統一 optimistic autosave + 統一「已儲存 ✓」微回饋（1.5s 淡出）。劇本因為有「重新生成」會覆蓋，保留顯式儲存但加同款回饋 |
| 10 | 🟠 | 成本散落 **4 個地方**，而且側欄標題係「本專案已使」— 集頁睇唔到「呢集用咗幾多」 | `page.tsx:144`、`panels.tsx:529-537,724-741,686` | 冇一個可信單一數字 | Inspector 一張**本集計費卡**：已使／在跑／待生成預估／模型 chips。站內橫幅刪走，只留掣上單價 |
| 11 | 🟡 | Rail 只有 3 態（done／active／idle），冇 blocked、審核中、失敗 | `PipelineBar.tsx:44-53` | 有失敗任務時 rail 一片正常，只靠紅 FAB 通知 | 五態設計：✓完成 ／ ◐進行中 pct ／ ✋待審 ／ ●紅點失敗數 ／ 🔒未解鎖 |
| 12 | 🟡 | 紅色 destructive **FAB 常駐右下**，搶咗主 CTA 視覺權重；`failedCount===0` 開過之後仍然 render | `FailureDrawer.tsx:72-87` | 平靜狀態下畫面最搶眼嘅係「錯誤」 | 降級：rail 上紅點 + Inspector 一節「失敗 3 · 全部重試」，抽屜保留但由呢兩處開；FAB 移除 |
| 13 | 🟡 | Badge 直出 **raw enum**（`STORYBOARD_CONFIRMED`） | `page.tsx:69` | 洩漏內部狀態機 | 中文狀態映射表 + 顏色語意；或者索性刪走（rail 已表達進度） |
| 14 | 🟡 | **原文站佔第一整屏**，內容係唯讀 8 行 + 「想改請重新建立一集」 | `panels.tsx:99-108` | 死站永遠擋住入口 | 降級：唔做獨立站內容，改做頂部 collapsible「📄 原文」抽屜，隨時任站可展開對照（分鏡對原文最有用） |
| 15 | 🟡 | **配音站零操作** — 唔可以逐句重配、改情緒、揀音色 | `panels.tsx:788-833` | 唯一唔可編輯嘅生成站，同其他站不對稱 | 每行加「重配」+ emotion／speaker 就地編輯 + 全集連播 |
| 16 | 🟡 | 空狀態全部同一句「仲未有 X。用右下角…」，冇掣、冇預覽、冇成本 | `panels.tsx:118,304,446,525,793,850` | 設計文檔要求「空狀態 = CTA + 示範」 | 每站空狀態 = 圖示 + 一句「會做乜」+ 主 CTA（帶成本）+「呢站會產出咩」示意 |
| 17 | 🟡 | **a11y**：rail 掣冇 `aria-current`／只有 `title`；候選圖 button 只靠 border 表達已選，冇 `aria-pressed`；CardTitle 唔係 heading；Progress 冇 `aria-valuetext` | `PipelineBar.tsx:38-42,54`、`panels.tsx:311-320`、`57-61` | 鍵盤／讀屏用戶行唔到流程 | rail = `<nav><ol>` + `aria-current="step"`；候選圖 `aria-pressed` + ✓ 角標（唔淨靠顏色）；station title 用 `<h2>` |
| 18 | 🟢 | stalled 警告插入 PipelineBar 下方，會**推低成頁內容**（CLS） | `page.tsx:79-86` | 斷線一刻畫面跳 | 改 rail 內 inline 狀態列（固定高度預留）或 toast |

## 3. 建議佈局

```
┌──────────────────────────────────────────────────────────────┐
│ 專案 · 第 3 集    [📄 原文 ▾]              已完成 4/8 · 52%  │ ← sticky
│ ①✓原文 ─ ②✋資產 ─ ③✓劇本 ─ ④◐分鏡 62% ─ ⑤🔒圖像 ─ ⑥🔒視頻 … │ ← rail：5 態、scroll-spy、aria-current
├────────────────────────────────────────┬─────────────────────┤
│  第 ④ 站 · 分鏡              [⋯]        │  下一步              │
│  ┌──────────────────────────────────┐  │  確認分鏡後開始生圖   │
│  │ (只 render 當前站)                │  │  預估 ~$1.24         │
│  │                                   │  │  [ 一鍵執行 ]        │
│  └──────────────────────────────────┘  │                      │
│                                         │  本集計費            │
│                                         │  已使 $0.42          │
│                                         │  在跑 $0.10          │
│                                         │  待生成 ~$1.24       │
│                                         │  🖼 seedream ~$0.04/張│
│                                         │  ⚠ 失敗 2 · 全部重試  │
├────────────────────────────────────────┴─────────────────────┤
│  ← 劇本            [ 🔄 重新規劃 ]  [ ✅ 確認分鏡 ]   圖像 →   │ ← 審核站 sticky bar
└──────────────────────────────────────────────────────────────┘
```

## 4. 落地分期

| 期 | 內容 | 風險 |
|---|---|---|
| **P0**（半日，純修） | #2 文案／#4 成本確認對稱／#6 拆走毀滅性掣／#13 狀態中文化 | 極低，唔郁結構 |
| **P1**（1-2 日） | #1 一次一站 + URL station param、#11 rail 五態、#3 blockedBy、#12 FAB 降級、#10 計費卡統一 | 中，`page.tsx` + `PipelineBar` 重寫，panels 幾乎不動 |
| **P2**（2-3 日） | #7 鏡頭台合併、#8 批量操作、#9 儲存模型統一、#15 配音可編輯、#16 空狀態、#17 a11y | 中高，`panels.tsx` 需拆檔（854 行 → 每站一檔） |

建議 **P0 + P1** 落一條薄片（符合「一 PR 一薄片」），P2 另開。

## 5. 競品用戶回饋（已完成）

見 **`2026-07-22-competitor-user-feedback.md`** — Toonflow (11.9k★) / 火豹短劇 (13.6k★) / waoowaoo (13.3k★) / LibTV 四個項目嘅
issues、PR、commit、社群回饋研究。

**對本文件嘅三點修正**：

1. **#1「一次一站」得到第三方驗證** — 火豹 v2.0 (2026-03-28) 主動 commit
   `feat: guided wizard for script panel — one step at a time`，即係一個 13.6k star 嘅同類產品
   喺累積一年用戶反饋之後轉向呢個方向。LibTV 由反方向印證（押注無限畫布 → 用「素材搵唔到 /
   版本對唔上 / 打組災難 / 學習成本」找數 → 花一個 release 買返結構）。

2. **#7 方案要改** — 唔好抄「card list + side editor」。火豹同 waoowaoo 都用呢個 pattern，
   兩邊都出 stale state 事故，火豹嗰個直接燒錢（「切換分鏡會把之前嘅提示詞帶出嚟，
   一唔小心就撳咗生成圖片」）。改抄 LibTV 嘅 **checkbox spreadsheet**：第一列勾選、
   可隱藏欄位、勾完批量轉圖。

3. **優先次序重排 + 新增 12 條研究驅動缺口（N1-N12）** — 見該文件 §4、§5。
   最大改動：**#4 成本確認升到最高**（「失敗即燒錢」係四個項目情緒最強嘅一類），
   **#8 批量操作升 🔴**，另加一個 **P0.5** 期做「每站手動上傳逃生門」
   （四項目共同未解需求 + 我哋 MediaObject 已有地基 = 最高 ROI）。
