# ReelCraft — MVP 設計文檔

> 日期：2026-07-18｜作者：Kelvin + Claude
> 前置研究：`~/Projects/ai-drama-platforms-report.html`（huobao-drama / Toonflow / waoowaoo 三專案深度對比）
> 狀態：已確認設計，未開工

## 0. 決策記錄（Brainstorm 結論）

| 問題 | 決定 |
|---|---|
| 目標用戶 | **先內部（2rocks studio）後 SaaS**；架構預留多租戶；之後行**開源核心 + 託管收費**雙軌 |
| 內容形態 | 真人感 + 動漫**兩樣都要**，畫風做成可插拔「畫風包」 |
| 資源 | **Kelvin 一人 + AI agents**（Claude Code 當工程團隊） |
| 輸入起點 | 三種都要：小說文字（M1）→ 自寫劇本（M1，跳過改寫站）→ SRT/音頻（M2） |
| MVP 路線 | **A・薄片直通車**：一個月內「貼小說→出一集成片」；多租戶 schema、provider 契約、SHADOW 計費第一日落地，其餘 YAGNI |
| MVP 廠商 | **OpenRouter**（text 全包）、**fal**（image/video/TTS/lip-sync 主力）、**AtlasCloud**（媒體副選 + A/B + fallback） |
| 額外硬性要求 | **Audit 所有 action + 每次 AI 呼叫嘅 token usage / model / 成本** |

授權警示：三個參考項目（兩個 CC BY-NC-SA、一個 Apache+商業限制）**程式碼一行不能抄**，只用架構模式與 prompt 思想，全部從零實作；prompt 文本亦重寫。

---

## 1. 產品定義 + User Flow

**一句話**：貼一段小說（或劇本/SRT），揀畫風同比例，系統引導行 8 個站，每站可人手改，最後出一集 9:16 短劇成片。

### MVP User Flow（引導模式，MVP 唯一模式）

```
① 建專案 ── 輸入類型（小說✅/劇本✅/SRT⏳M2）+ 畫風包 + 比例 + 模型預設
② 貼原文 ── 長文自動偵測 → 建議分集 → 用戶確認分集邊界
③ 資產站 ── 自動抽角色/場景 → 逐個生圖（3 選 1）→ ✋審核點：鎖定資產
④ 劇本站 ── 改寫/轉換為劇本 → 用戶可直接編輯文本（自帶劇本由此站入）
⑤ 分鏡站 ── 四階段導演組（規劃→攝影→表演→細節）→ ✋審核點：改文字分鏡
⑥ 圖像站 ── 逐鏡生圖（引用已鎖定資產保一致性）→ 單鏡重生
⑦ 視頻站 ── i2v 逐鏡生成 → TTS 配音自動對齊
⑧ 成片站 ── 自動拼接 + 字幕 → 預覽 → 導出 MP4
```

### 三件貫穿全程嘅 UX 固定件（解決 Toonflow 實測「唔知下一步」問題）

1. **進度總覽條**（頂部常駐）：八站各顯示 `完成數/總數`（如「圖 12/18」），點擊跳站。
2. **Next Best Action 卡**（右下角常駐）：根據管線狀態計算「而家最應該做嘅一件事」+ 一鍵執行。
3. **失敗抽屜**：所有失敗/卡死任務集中一處，逐項一鍵重試（只重跑失敗 step）。

輔助：鎖住嘅站 hover 顯示「還差什麼」清單（可點擊直達）；空狀態 = CTA + 內建示範專案。

**審核點只設兩個**（③資產、⑤分鏡）：呢兩樣係下游一切嘅依賴，喺呢度把關重生成本最細；其他站行雲流水。

---

## 2. 架構

### 技術棧

```
Next.js 15 (App Router) ─ 前端 + API routes 一個倉
PostgreSQL + Prisma     ─ 所有表帶 userId
BullMQ + Redis          ─ 4 條佇列 (text/image/video/voice) + watchdog
S3 相容儲存             ─ 開發 MinIO docker，上線可轉 Cloudflare R2
Better-Auth             ─ 內部期 email+password；SaaS 期加 OAuth
```

### 部署

一部 VPS 行 docker-compose 五個 container：`app / worker / postgres / redis / minio`。
**app 同 worker 第一日就分開 container**（修正 waoowaoo 單容器綁定嘅缺陷），將來直接加 worker 副本。唔用 K8s。

### 資料模型（~15 個 model，濃縮 waoowaoo 嘅 40 個）

```
User → Project → Episode → Scene(切塊) → Shot(鏡頭)
                │            Shot: 圖prompt/圖/視頻prompt/視頻/狀態
                ├ Character / Location（+ 已鎖定外觀圖）
                ├ VoiceLine（台詞→TTS→對齊 Shot）
                └ Task / TaskEvent（佇列對帳 + SSE 進度）
MediaObject（內容定址；DB 只存 storage key，讀取時簽名 URL 水合）
UsageCost（由 AiCallLog 聚合）
AuditLog / AiCallLog（見 §3）
```

### 第一日必做（遲補十倍成本）

- 全表 `userId`（多租戶 ready）
- `provider::modelId` 嚴格契約（禁猜測/禁降級）
- `MediaObject` 間接層
- SHADOW 計費（只記帳唔扣錢）
- Guard 腳本框架（見 §6）
- `callModel()` / `generateMedia()` 唯一 AI 入口

### 刻意唔做（YAGNI，全部「加得返」）

事件溯源 Graph run、無限畫布、Agent 對話層、多語 UI（先繁中）、計費 ENFORCE、團隊協作、K8s。

---

## 3. Audit 層（硬性要求）

```
AuditLog   ─ userId + 時間 + action + targetType/targetId + 來源(UI/agent/system/watchdog) + metadata
             例：asset.lock、shot.regenerate、episode.export、settings.change
AiCallLog  ─ 每次 AI 呼叫一行：provider::modelId、apiType、tokens in/out（或 秒數/張數）、
             單價快照、估算成本、latency、成功/失敗+錯誤碼、prompt 模板 ID+版本、taskId
```

**結構性保證**：所有 AI 呼叫必須經 `callModel()` / `generateMedia()` 唯一入口，入口自動寫 `AiCallLog`；guard 腳本掃描直連 provider SDK 嘅 code，CI fail（仿 waoowaoo `no-media-provider-bypass`）。

**回報 UI**：Profile「用量」tab——按日/專案/模型嘅成本圖、**每集實際使費**（SaaS 定價依據）、邊支 prompt 食 token 最多、邊間廠商最慢最貴。`AiCallLog` 記 prompt 版本 → 將來 prompt A/B 有現成數據。

---

## 4. 任務系統 + Provider 層

### 任務生命週期

```
提交 ─ submitTask()：dedupeKey 去重 → Task 行(queued) → BullMQ(jobId=taskId) → SSE
執行 ─ worker 原子搶佔（active-guarded update）→ 10 秒心跳 → 進度經 Redis pub/sub → SSE
完結 ─ 成功寫 result + AiCallLog；失敗分類：
       retryable（429/超時/5xx）→ 指數退避最多 3 次
       terminal（內容審查/參數錯）→ 即 fail 入失敗抽屜
看門 ─ watchdog 每 30 秒：心跳斷 90 秒殭屍 → 重置 queued；超上限 → failed
```

取態：**重試由 app 層話事，唔係 BullMQ 話事**（分開「值得重試」同「重試嘥氣」）。

### Provider 層

1. **契約**：`provider::modelId` + 統一入口 + 能力目錄 JSON（model 支援秒數/解像度/首尾幀）。
2. **MVP 三個 adapter**：
   - **OpenRouter** = text 全包（一把 key 試晒各家，用 AiCallLog 數據揀）
   - **fal** = 媒體主力（image nano-banana 系／video Kling/Wan/Veo/Sora／TTS IndexTTS-2／lip-sync）
   - **AtlasCloud** = 媒體副選（國內模型聚合，價格向；同 fal A/B + fallback）
   - fal 同 AtlasCloud 都係「提交→輪詢/webhook」形態，adapter 結構相同。
3. **M2 上宣告式模板**（JSON template：create/status/content endpoint + JSONPath + 輪詢配置），之後加廠商唔使寫 code。
4. **金鑰**：內部期 server env vars；SaaS 期換 per-user 信封加密 BYO-Key。`getProviderKey(userId)` 抽象第一日存在，到時只換實現。**API 永不回傳明文金鑰**（waoowaoo 教訓）。

---

## 5. Prompt 體系 + 畫風包

### 目錄結構（prompt 係資產，入 git）

```
prompts/
  pipeline/   改寫、抽資產、切塊、分鏡四階段、台詞分析（.zh.txt + 變數宣告）
  styles/     畫風包：風格前綴 + 禁用詞表 + 負面詞 + 參考語彙（一包一 folder）
  models/     模型專屬視頻 prompt 格式（fal-kling.md / atlas-wan.md …）
  canary/     黃金樣本：固定輸入 → 預期輸出結構，CI 跑
```

### 三家精華重寫入庫（意念，非原文）

- huobao：分鏡時間分段標籤 DSL、防偷懶條款、宮格 exactly-N 防退化
- Toonflow：180° 軸線守恆、@图N 參考綁定、畫質禁用詞表、silent 防口型、150 字/分鐘台詞配比
- waoowaoo：淺景深修口型、15 字一鏡配比、顏色抑制、情緒強度上限 0.5、「」引號防 JSON 爆、source_text 強制回填

### 治理

① 渲染時變數嚴格驗證（placeholder 唔對即拋錯）② canary 迴歸鎖結構 ③ AiCallLog 記模板版本，質素/成本有數睇。

---

## 6. 里程碑 + Solo × AI Agents 工作法

| 里程碑 | 範圍 | 收貨條件（以「出到乜」收貨） |
|---|---|---|
| **M0 · 地基**（1 週） | repo + docker-compose + auth + schema + guard 框架 + callModel() | AiCallLog 有第一行記錄 |
| **M1 · 直通車**（3-4 週） | 八站引導流程全通 | 自己 30 分鐘出一集；kill worker 任務自動恢復 |
| **M2 · 內部生產**（4 週） | SRT 輸入、宣告式模板、失敗抽屜、用量儀表板、畫風包 ×3 | 工作室真實出片，每集成本有數 |
| **M3 · 開源+SaaS 準備** | BYO-Key 加密、ENFORCE 計費、配額、開源倉整理 | 一個外人成功自 deploy + 一個付費用戶全程走通 |

### 工作法

- **Guard 先於 code**：每個架構決策即寫 guard 腳本；你定不變式，agents 框內填肉。
- **每個 PR 一條薄片**：每次交付駁通「貼文→出嘢」某一段，唔起大 framework。
- **Prompt 迭代同 code 迭代分開**：canary 鎖結構，人專心調質素。
- **AiCallLog 每週睇一次**：貴嘅 prompt、慢嘅廠商即刻換。
