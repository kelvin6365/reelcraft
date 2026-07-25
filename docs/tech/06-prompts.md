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
```

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
