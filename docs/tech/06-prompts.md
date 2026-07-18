# 06 · Prompt 體系

鐵律：prompt 唔准 inline 喺 code；一律檔案 + catalog + 變數驗證 + canary。

## 目錄

```
prompts/
  catalog.json          # 每支 prompt：id、path、version、variables[]、outputSchema ref
  pipeline/
    episode_split.zh.txt
    extract_assets.zh.txt
    rewrite_script.zh.txt
    build_scenes.zh.txt          # 錨點切塊：LLM 回 start/end 錨點，code 定位原文
    storyboard_plan.zh.txt       # 四階段①規劃
    storyboard_photography.zh.txt# ②攝影（含淺景深修口型規則）
    storyboard_acting.zh.txt     # ③表演（抽象情緒詞→可見表現）
    storyboard_detail.zh.txt     # ④細節（鏡頭語言庫）
    voice_analyze.zh.txt         # 情緒強度 0.1-0.5 上限
    image_prompt_shot.zh.txt     # 鏡→生圖 prompt（引用鎖定資產）
  styles/
    anime-01/style.json          # {prefix, negativePrompt, bannedWords[], vocab}
    cinematic-01/style.json
  models/
    fal-kling.md                 # 各 video model 嘅 prompt 格式規範
    atlas-wan.md
  canary/
    build_scenes.canary.json     # {input, mustHaveKeys[], mustMatch[], mustNotMatch[]}
    storyboard_plan.canary.json
```

## 載入與渲染

```ts
buildPrompt(promptId, variables: Record<string,string>): {text, promptId, version}
// 1. catalog 搵 path + version + variables 宣告
// 2. 讀檔（in-memory cache，mtime 失效）
// 3. 嚴格驗證：模板 {placeholder} 集合 === catalog variables === 傳入 keys，唔對即 throw
// 4. 回傳連 version —— caller 交俾 callModel()，落 AiCallLog
```

## 輸出解析

- 所有 pipeline prompt 要求純 JSON 輸出；解析用 `safeParseJson()`（剝 markdown fence、引號「」還原）。
- 解析失敗 = retryable（重試 prompt 加一句「上次輸出唔係合法 JSON」）；最多 2 次後 terminal。
- 結構驗證用 zod schema（`src/lib/pipeline/schemas.ts`），schema 同 canary 共用。

## Canary 迴歸（CI 必跑）

- **結構級**（免費、每次 CI）：canary input 行 `buildPrompt` → 驗變數渲染成功 + 模板包含 mustMatch 關鍵約束句（例：storyboard_photography 必含「淺景深」規則）。改壞模板即 fail。
- **語意級**（俾錢、手動/每週）：真 LLM 跑 canary input → zod 驗輸出結構 → 關鍵欄位 spot check。`npm run canary:live`。

## 撰寫規範（三家精華沉澱）

1. 輸出格式規則行先、⚠️ 標優先級；禁止 markdown 包 JSON。
2. 引號一律要求「」（防 JSON 爆）。
3. 追溯性：分鏡類輸出必含 `source_text` 回填。
4. 防偷懶條款：「你必須直接輸出完整結果，不要返回步驟或指令」。
5. 量化錨點：15 字/鏡、150 字/分鐘、情緒 ≤0.5、外貌描述按角色等級定字數。
6. 生圖 prompt 出英文；指令用中文寫。
7. 畫風污染防護：style prefix 唔准覆蓋內容元素（畫面描述行先、風格詞行後）。
