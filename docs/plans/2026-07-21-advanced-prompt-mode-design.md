# 進階模式：Prompt 檢視與編輯（設計）

**日期**：2026-07-21
**狀態**：設計完成，待實作
**背景**：用戶要求一個「進階模式」，可以睇到每個生產站送去 AI 嘅完整 prompt，並且可以編輯。

---

## 1. 架構總覽與資料模型

### Prompt 解析鏈

照抄 model defaults 嘅三層心智模型（見 `docs/tech/03-provider-layer.md`）：

```
resolvePrompt(promptId, { userId, projectId })
  → project override（PromptOverride: projectId + promptId）
  → user override（PromptOverride: userId + promptId, projectId = null）
  → system（prompts/ 檔案，catalog.json 版本）
```

`resolvePrompt()` 係讀取 prompt 嘅**唯一入口**，同 `callModel()` 一樣由 guard script 強制。

### 新表 PromptOverride

跟鐵律 #1，所有表帶 `userId`：

```prisma
model PromptOverride {
  id          String   @id
  userId      String   // 多租戶
  projectId   String?  // null = user 層；有值 = project 層
  promptId    String   // 對應 catalog.json 嘅 id，例如 "storyboard_plan"
  content     String   // 完整 template 文字
  baseVersion String   // 由邊個 system 版本改出嚟（用於 drift 提示）
  updatedAt   DateTime

  @@unique([userId, projectId, promptId])
}
```

### AiCallLog 擴充

新增兩欄：

- `renderedPrompt String?` — 生成時實際送出嘅完整 prompt 全文
- `promptSource String?` — `"system" | "user" | "project" | "oneoff"`

寫入點喺 `callModel()` 唯一入口，順住現有 audit 路徑，唔使改呼叫端（鐵律 #2 不變）。

**取捨**：長原文每次生成都存全文會令 DB 增長。接受呢個代價，因為忠實重現審計係呢個功能嘅核心價值；如果日後成為問題，可以加保留期清理（例如只保留最近 N 次或 90 日）。

### 單次改重跑（不入表）

「編輯重跑」唔會寫 `PromptOverride`。Task payload 加 optional `promptOverrideText`，行完即棄，AiCallLog 記 `promptSource: "oneoff"` 保留審計軌跡。

### 不變式

System 檔案（`prompts/`）永遠唔郁，canary 迴歸照鎖（鐵律 #7）。所有用戶編輯都係 DB 層 override。

---

## 2. 驗證機制與版本過期

### 儲存時驗證（server-side）

1. **變數硬驗證**：由 `catalog.json` 攞該 prompt 嘅 `variables` 清單，逐個檢查 `{{variable}}` placeholder 存在。缺任何一個 → 400，回傳邊啲缺咗，**唔俾存**。多咗未知變數 → 警告（可能係 typo）但唔阻擋。

2. **格式警告（唔阻擋）**：偵測 system 版有但用戶版刪走嘅結構性區塊 — 抽 system template 入面嘅 JSON 輸出指示段（「回傳 JSON」「輸出格式」等關鍵字段落、code fence 內嘅 schema 示例），如果用戶版搵唔到近似段落，顯示：

   > ⚠️ 你可能刪咗輸出格式指示，模型好可能唔再回傳有效 JSON，下游會解析失敗。

3. **前端輔助**：編輯器側欄常駐該 prompt 嘅變數清單（綠剔＝已包含），儲存前 client 行同一套驗證即時反饋。

### 版本過期（version drift）

Override 記住 `baseVersion`。當 `catalog.json` 嘅 system 版本升咗（例如 3 → 4），該 override 喺 UI 顯示「基於 v3 修改，官方已更新到 v4」badge，提供三個出路：

- **睇 diff** — 三欄對照（你嘅版本 / 舊 system / 新 system）
- **一鍵還原** — 刪 override，用返 system 新版
- **繼續用** — 唔阻擋生成，照用用戶版

「一鍵還原」任何時候都可用（唔止過期時），用 `ConfirmDialog` 確認，同現有破壞性操作 pattern 一致。

---

## 3. UX 詳細

### 進階模式開關

Settings 新增「進階」區 — 一個 switch：「進階模式：檢視及編輯 AI Prompt」。存喺 user 設定（DB，跨裝置跟人）。關閉時下面所有入口完全隱藏，新手介面保持乾淨。

### 站內 rendered 層（單次）

每個會呼叫 text 模型嘅站 panel header 加一個 `<>` icon 掣「Prompt」，撳開 Sheet（右側抽屜，同 `FailureDrawer` 同款）：

**「上次送出」tab**
由 AiCallLog 讀 `renderedPrompt`（該站最近一次呼叫），顯示唯讀全文＋metadata：模型、prompt 版本、來源層 badge（系統／個人／專案／單次）、時間、token 數。冇記錄就顯示「呢個站未生成過」。

**「編輯重跑」tab**
預填上次 rendered 全文（或用當前 template 即時 render 預覽），用戶自由改，撳「用呢個 Prompt 重新生成」→ 行現有 regen 路徑但帶 `promptOverrideText`。掣旁顯示預估成本（跟 `NextActionCard` 同一來源），文案講明「單次生效，唔會影響模板」。

### 模板層（長效）

**Settings →「Prompt 模板」分頁（user 層）**
11 個 pipeline prompt 列表（名稱＋一句 description 來自 catalog），有 override 嘅行顯示「已自訂 · 基於 v3」badge。撳入去全屏編輯器：左邊 textarea、右邊變數 checklist＋說明，底部「儲存 / 還原官方版 / 睇 diff」。

**專案頁 →「Prompt」區（project 層）**
同一個編輯器組件，多一個「繼承」狀態顯示 — 每個 prompt 標明目前生效層（系統／個人／本專案），project override 只喺呢個專案生效。

---

## 4. API、錯誤處理、測試

### API（全部 auth-scoped）

| Endpoint | 用途 |
|---|---|
| `GET /api/prompts` | catalog 清單＋每個 prompt 目前生效層（`?projectId=` 就計埋 project 層） |
| `GET /api/prompts/[promptId]` | system 原文＋user/project override（如有）＋變數清單 |
| `PUT /api/prompts/[promptId]` | 建立／更新 override（body: `content`, `projectId?`）— 行第 2 節驗證 |
| `DELETE /api/prompts/[promptId]` | 還原（刪 override，`?projectId=` 分層） |
| `GET /api/episodes/[id]/last-prompt?stage=` | 由 AiCallLog 讀該站最近 `renderedPrompt` |

### 錯誤處理

Render 時如果 override 變數代入失敗（儲存驗證已擋，但防 catalog 升版加新變數）→ 唔靜默 fallback，task fail 出新錯誤碼 `PROMPT_OVERRIDE_INVALID`。`src/lib/task/error-copy.ts` 加人話：

> 你嘅自訂 Prompt 缺少新變數 X，請去模板頁更新或還原官方版。

標記為 terminal（重試冇用），動作連結指向模板頁 — 跟鐵律 #6 同現有錯誤引導 pattern。

### 測試與 guard

- **Unit**：`resolvePrompt` 三層優先序、變數驗證、drift 偵測（照抄 `tests/model-defaults.test.ts` 風格）
- **新 guard** `scripts/guards/prompt-resolve-check.mjs`：禁止 `resolvePrompt` 以外直讀 `prompts/pipeline/`（鐵律 #8）
- **Canary**：只鎖 system 版，override 唔入 canary（用戶自己負責）

---

## 5. 實作切片

每片一個 PR，每片都駁通一段可用流程：

1. `resolvePrompt` ＋ `PromptOverride` 表 ＋ `renderedPrompt` 落 log
2. 站內「上次送出」唯讀檢視
3. 編輯重跑（單次 `promptOverrideText`）
4. 模板管理 UI（user 層）
5. Project 層 override ＋ drift diff

---

## 6. 明確唔做（YAGNI）

- Prompt 版本歷史 / 回溯到任意舊版（只有「還原官方版」）
- A/B 測試兩個 prompt 比較效果
- Prompt 分享 / 市集
- 非 text 模型（圖像／視頻）嘅 prompt 編輯 — 呢啲已經喺分鏡表逐鏡可改
