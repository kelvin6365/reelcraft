# 06 · Prompt 體系

鐵律：prompt 不准 inline 寫在 code 中；一律以檔案 + catalog + 變數驗證 + canary 管理。

## 目錄

```
prompts/
  catalog.json          # 每支 prompt：id、path、version、variables[]、outputSchema ref
  pipeline/
    episode_split.zh.txt
    extract_assets.zh.txt
    rewrite_script.zh.txt
    build_scenes.zh.txt          # 錨點切塊：LLM 回傳 start/end 錨點，由 code 定位原文
    storyboard_plan.zh.txt       # 四階段①規劃
    storyboard_photography.zh.txt# ②攝影（含淺景深修口型規則）
    storyboard_acting.zh.txt     # ③表演（抽象情緒詞→可見表現）
    storyboard_detail.zh.txt     # ④細節（鏡頭語言庫）
    voice_analyze.zh.txt         # 情緒強度 0.1-0.5 上限
    image_prompt_shot.zh.txt     # 鏡頭→生圖 prompt（引用鎖定資產）
  styles/
    anime-01/style.json          # {prefix, negativePrompt, bannedWords[], vocab}
    cinematic-01/style.json
  models/
    fal-kling.md                 # 各 video model 的 prompt 格式規範
    atlas-wan.md
  canary/
    build_scenes.canary.json     # {input, mustHaveKeys[], mustMatch[], mustNotMatch[]}
    storyboard_plan.canary.json
    extract_assets.canary.json
```

## Prompt 版本紀要

- **`extract_assets`（v16）**：新增角色 `appearance` 與 `wardrobe` 兩條欄位禁令（交付標準第一片，見 [交付標準設計](../plans/2026-08-03-delivery-standards-design.md) §3.1 / §3.4）。`appearance` 只准寫畫得出的外觀，職業／能力／經歷／性格一律歸小傳欄位——混入非視覺內容會令生圖模型自行摘取，蒸發掉真正的核心外貌特徵。`wardrobe` 只准寫著戴在身上的東西，手持武器歸道具——武器寫進 wardrobe 會與角色鎖定圖的「雙手自然下垂、空手」自相矛盾，且鎖定圖是每一鏡的身份參考，武器會跟著角色進入每一格，架空逐鏡道具匹配。兩條各附實測反面例子與逐項自我檢查。

- **`extract_assets`（v3）**：加場景視角建議判斷準則——重要場景（出現於兩場或以上戲，或屬關鍵劇情發生地）必須輸出 ≥2 個 `angles`（`{label, prompt}`，普通場景空陣列）；label 須具體到空間關係，prompt 30–60 字、嚴禁人物。輸出結構 `locations[]` 新增 `angles` 欄。對應 zod schema（`src/lib/prompts/schemas.ts`）所有自由文本欄位與 `angles` 皆 nullish→預設值（`""` / `[]`），容忍模型漏答或輸出 null。
- **`image_prompt_shot`（v7）**：圖例規則加一句——標示「（場景視角：…）」者為同一場景的不同機位參考，按本鏡頭構圖需要選取最貼合的一張；「（場景主視角）」為該場景建立鏡頭全貌。參考圖組裝見下方「鏡頭參考圖組裝」。

## 鏡頭參考圖組裝（`buildShotRefAssets`，`src/lib/prompts/shot-assets.ts`）

鏡頭生圖前組裝 reference 陣列，優先序固定：

1. 出場角色（`locked && lockedImageMediaId`）——全身圖 + 面部特寫（`faceImageMediaId`，如有）
2. 場景主視角（`lockedImageMediaId`）
3. 場景建議視角（`angles`，只取已生成即 `mediaId` 非空者）

`MAX_SHOT_REFS = 6`——在 legend 編號之前顯式截斷（下游 `normalizeReferenceImages` 對超過 6 張會靜默 splice，若不在此層先行截斷，圖例編號與實際送出的圖片會錯位）。

## 載入與渲染

```ts
buildPrompt(promptId, variables: Record<string,string>): {text, promptId, version}
// 1. 於 catalog 尋找 path + version + variables 宣告
// 2. 讀取檔案（in-memory cache，mtime 失效）
// 3. 嚴格驗證：模板 {placeholder} 集合 === catalog variables === 傳入 keys，不符即 throw
// 4. 回傳連同 version —— caller 交給 callModel()，寫入 AiCallLog
```

## 輸出解析

- 所有 pipeline prompt 要求純 JSON 輸出；解析使用 `safeParseJson()`（剝除 markdown fence、還原引號「」）。
- 解析失敗屬於 retryable（重試 prompt 時加一句「上次輸出不是合法 JSON」）；最多重試 2 次後判定為 terminal。
- 結構驗證使用 zod schema（`src/lib/pipeline/schemas.ts`），schema 與 canary 共用。

## Canary 迴歸（CI 必跑）

- **結構級**（免費、每次 CI）：canary input 執行 `buildPrompt` → 驗證變數渲染成功 + 模板包含 mustMatch 關鍵約束句（例如：storyboard_photography 必含「淺景深」規則）。若模板改壞即 fail。
- **語意級**（付費、手動/每週）：以真實 LLM 執行 canary input → zod 驗證輸出結構 → 關鍵欄位 spot check。`npm run canary:live`。

## 撰寫規範（三家精華沉澱）

1. 輸出格式規則行優先、⚠️ 標示優先級；禁止以 markdown 包裹 JSON。
2. 引號一律要求使用「」（防止 JSON 破裂）。
3. 追溯性：分鏡類輸出必含 `source_text` 回填。
4. 防偷懶條款：「你必須直接輸出完整結果，不要返回步驟或指令」。
5. 量化錨點：15 字/鏡、150 字/分鐘、情緒 ≤0.5、外貌描述依角色等級決定字數。
6. 生圖 prompt 輸出英文；指令以中文撰寫。
7. 畫風污染防護：style prefix 不准覆蓋內容元素（畫面描述行優先、風格詞行在後）。
