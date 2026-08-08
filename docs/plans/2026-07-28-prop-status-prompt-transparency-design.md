# 道具資產（Prop）狀態與 Prompt 透明度設計

## Context

道具資產功能上線後實測發現兩個 UX 缺口：

1. **狀態不透明**：一個 `IMAGE_PROP` task 卡喺 processing 狀態（heartbeat 仍在跳動但冇進度），UI 完全冇顯示——冇「生成中」進度、冇錯誤，用戶淨係見到「重生」按鈕變灰但唔知原因。追查後發現：SSE 頻道（`live`）收到 `FAILED` 事件會即刻刪走對應 entry 並觸發 refetch，但 refetch 攞返嚟嘅 `activeTask` 一離開 queued/processing 狀態就變 `null`——errorCode 完全冇地方存低，只落入 project 層面嘅 `FailureDrawer`（顯示「IMAGE_PROP failed」，唔會話你知係邊件具體道具）。
2. **Prompt 不透明**：AssetCard 只俾用戶編輯 `prompt`/`material`/`dimensions`/`view.prompt` 呢啲片段，但實際傳去 `generateImage()` 嘅完整 prompt（style 前綴 + `PROP_REF_FRAMING` + `PROP_IDENTITY_LOCK_OPEN/CLOSE` + negative prompt）係喺 `src/lib/prompts/prop-views.ts` 組裝，用戶完全睇唔到。呢個喺 debug「反面生成咗完全唔同嘅武器」呢類一致性問題嗰陣尤其關鍵——用戶冇辦法喺撳「生成」之前確認個 prompt 係咪合理。

研究確認 `AiCallLog.renderedPrompt` 呢個欄位只有文字生成路徑（`callModel()`）會寫入，圖像/影片生成路徑（`generateImage()`/`generateVideo()` → `logMediaCall`）從未寫過，即係話呢個問題唔淨係「UI 冇顯示」，係後端本身都冇儲低呢份資料。

範圍：**淨係道具（Prop）**，Character/Location 用緊同一個 `AssetCard` component，同樣缺乏呢兩種透明度，但今次唔動佢哋，留返後續。

## 設計

### 1. Status 穿透到卡片層級

唔靠 SSE 帶 error（SSE 本質上唔保證送達），改用「由 DB 直接查返嚟、有 refetch 就一定啱」嘅欄位：

- `episode-snapshot.ts` 新增一條 project-scoped query：攞返所有 Prop 嘅**最新一個 terminal task**（`IMAGE_PROP`/`VIDEO_PROP`，按 `targetId` 分組取最新一筆 `failed`/`completed`）。獨立於而家 episode-scoped 嘅 `terminalTasks`，因為道具生圖 task（同 Character/Location 一致）唔綁 `episodeId`，只綁 `projectId`。
- `PropView` 新增 `lastError: { code, message, humanized, failedAt } | null`——只有「最新一次 attempt 係失敗」先有值；補撳「重生」成功之後，下次 refetch 自動變 `null`（因為最新 terminal task 變咗 completed）。
- Card 上面 `inFlight`（生成中，顯示 progress）同 `lastError`（失敗，顯示 humanized 訊息 + 內嵌「重試」按鈕，直接沿用而家嘅 regenerate 按鈕，唔開新 retry-by-taskId 機制）互斥顯示；兩者都冇就維持而家嘅樣。

### 2. 「查看實際 Prompt」即時預覽

`buildPropMainPrompt`/`buildPropViewPrompt`/`buildPropNegativePrompt`（`prop-views.ts`）係 pure function，唔碰 DB/AI——呢個係「唔使真係生成」都預覽到嘅關鍵，亦都保證預覽同實際生成用緊**同一份邏輯**，唔會兩邊飄散。

- 新增 `POST /api/props/[id]/preview-prompt`：body 帶用戶未 save 嘅草稿（`material`/`dimensions`/`prompt`/`tier`/`view: {index, label, prompt}`/`effectVideo: boolean`）。Server 攞返 project 嘅 style pack，將 draft 覆蓋喺已存值上面，call 返嗰幾個 build 函數，回傳 `{ mainPrompt, negativePrompt, viewPrompt?, videoPrompt? }`。純計算，冇 `assertWithinBudget`、冇 provider call，唔會嘥錢。
- Card UI：主圖區加一個「查看實際 Prompt」摺疊區，展開先 call API（唔一開卡就 call）。編輯 material/dimensions/prompt 嗰陣 debounce ~500ms 自動重新 call，內容即時更新。Key tier 每個 view row 都加細版摺疊，傳埋該 view 嘅 draft。Effect tier 嘅摺疊區傳 `effectVideo: true`，回傳嘅係將會傳去 `generateVideo()` 嘅 videoPrompt。
- 顯示格式：`<pre>` 原文顯示 mainPrompt/viewPrompt/videoPrompt，negativePrompt 細字放底，排版風格睇齊現有 `StationPromptSheet`。

### 3. 卡片組裝、邊界情況

卡片由上至下：tier badge + 名稱 + 鎖定狀態 →【新】狀態列(inFlight/lastError 互斥) → description/material/dimensions →【新】「查看實際 Prompt」摺疊區(主圖) → views 編輯器(每行加細版預覽) → effect tier 嘅 physicalParams + 動態片段(摺疊區傳 `effectVideo:true`) → 候選圖/已鎖定圖。

邊界情況：
- Style pack 讀取失敗——`loadStyle` 現有 try/catch 回退空物件，preview endpoint 沿用，唔會令預覽掛咗。
- scene tier 道具——preview 顯示提示「呢張圖會以場景「XXX」嘅鎖定圖做參考」（`sceneRef` 有值先顯示）。
- 未鎖定主圖打開 view 預覽——照樣計到（pure function 唔需要 lockedImageMediaId），底部加提示「未鎖定主圖，生成時會被拒絕」。

## 驗證

- `prop-views.ts` 現有單元測試延伸覆蓋 preview endpoint 嘅組裝邏輯。
- `episode-snapshot.ts` 新增嘅 `lastError` 查詢至少一個 test 覆蓋「最新一次係 completed 就要係 null」嘅情況。
- 手動 QA（`MODEL_DEFAULTS_PRESET=fake`）行一次完整流程：生成中 → 失敗 → 重試 → 成功，確認 badge 轉換正確；打開「查看實際 Prompt」確認同實際 `generateImage()` call 嘅 prompt 一致。
