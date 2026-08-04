# 03 · Provider 層

鐵律：model 引用一律為 `provider::modelId`；禁止 provider 猜測/靜態映射/預設降級；所有呼叫經唯一入口（04-audit.md）。

## 契約

```ts
type ModelKey = `${string}::${string}`          // 'fal::fal-ai/nano-banana-pro'
type ApiType = 'text' | 'image' | 'video' | 'tts'

parseModelKeyStrict(key): {provider, modelId} | null   // 沒有 '::' 即為 null，caller 必須 throw

interface TextAdapter  { complete(req: TextRequest): Promise<TextResult> }       // + stream 變體
interface MediaAdapter {
  submit(req: ImageRequest | VideoRequest | TTSRequest): Promise<{externalId} | {resultUrl}>
  poll(externalId): Promise<{status:'pending'|'done'|'failed', resultUrl?, error?}>
}
// TextResult 必含 usage {inputTokens, outputTokens}；MediaResult 必含 quantity（張/秒/字符）
// —— callModel() 需依賴這些欄位寫 AiCallLog，adapter 不提供 usage 即為 bug
```

## Provider 註冊表（`src/lib/providers.ts`）

Provider 是一等配置實體（TS const，而非 JSON——因為 adapter/auth 本身就是 code path）：

```ts
ProviderDef { id, label, envKeyName, authScheme: 'bearer'|'key'|'none', byok, devOnly }
PROVIDERS = [openrouter, fal, atlascloud, fake]   // v1 只內建這些；BYOK_PROVIDERS 由此派生
```

- `/api/models` 由註冊表 + 能力目錄組合出 picker feed：`{ providers:[{id,label,connected}], models:[…] }`。`connected` 只檢查 key **是否存在**（user key → `user-key`；env key → `env-key`；否則 `none`），不做即時 ping。
- Guard：`provider-registry-check` —— 目錄中每條 modelKey 的 provider 前綴必須存在於註冊表；系統預設必須存在於目錄且 apiType 相符；禁止 `fake::pipeline` / `?? "fake::` 這類兜底 pattern 復發。

## 三層模型預設解析（`src/lib/model-defaults/resolve.ts`）

```
system（code 常數，真實模型）← user（user_model_defaults 表，於 /settings 設定）← project（projects.modelDefaults）
按 apiType 逐項解析；最具體且【合法】（存在於目錄、apiType 相符）的一層勝出；
非法項則記錄並跳過、落回上層——永不靜默降級為 fake（鐵律 #3）。
```

- 系統預設：text=`openrouter::google/gemini-2.5-flash-lite`、image=`fal::fal-ai/nano-banana-pro`、video=`fal::fal-ai/kling-video/v3/standard/image-to-video`、tts=`fal::fal-ai/minimax/speech-02-hd`。
- **解析在 run time 進行**（worker `resolveTaskModels`）——不 snapshot 到 task payload（否則會破壞批量 dedupeKey 的確定性以及重試 UX）。billing（quote/budget）走同一個 resolver，確保報價與執行一致。
- Dev/CI 沒有 key 時：以 env `MODEL_DEFAULTS_PRESET=fake` 顯式將 system 層換成 fake::*（屬於顯式配置，不算降級）。**生產環境必須留空。**
- 站台 UI（圖像/視頻站 header chip）顯示解析結果 + 單價；fake 則以橙色警示標示。

## MVP 三個 adapter

### openrouter（text 全包）
- 使用 OpenAI SDK 指向 `https://openrouter.ai/api/v1`；一把 key。
- 串流：SSE delta 直通 `task_events`。usage 由 response 尾包取得。
- 起步 model：分析/抽取使用較平價的（`deepseek/…` 或 `google/gemini-flash`），分鏡四階段使用較優質的（`anthropic/claude-sonnet-*`）——哪個崗位用哪個 model 存於 `projects.modelDefaults`，依 AiCallLog 數據調整。

### fal（媒體主力）
- Queue API：`POST https://queue.fal.run/{modelId}` → `{request_id}` → poll `/requests/{id}/status`。
- image：nano-banana 系；video：Kling / Wan / Veo（以 i2v 為主，首尾幀見下方「尾幀錨定」）；TTS：IndexTTS-2（reference audio 聲音克隆）；lip-sync 列入 M2。
- 參考圖放入 request：使用 MediaObject 簽名 URL（若 fal 能拉取到公網 URL 則不需要 base64）。

### atlascloud（媒體副選）
- 同樣為「提交→輪詢」聚合器形態，adapter 結構參照 fal 的外殼。
- 用途：國內模型（豆包/可靈/Vidu 系）+ 價格 A/B + fal 故障時的 fallback。
- Fallback 規則：**僅在 submit 階段失敗時（而非生成品質不佳）才自動切換**，且須寫入 audit；生成過程中途不切換。

## 能力目錄（`standards/capabilities.json`）

```json
[{ "modelKey": "fal::fal-ai/kling-video/v3/standard/image-to-video",
   "apiType": "video",
   "capabilities": { "durationsSec": [5, 10], "resolutions": ["720p","1080p"],
                     "modes": ["i2v"], "aspectRatios": ["9:16","16:9"] },
   "pricing": { "mode": "flat", "perUnit": 0.28, "unit": "second", "currency": "USD" } }]
```

- 提交任務時校驗選項是否合法（不合法即 throw，不應讓錯誤傳到 provider 端才爆發）。
- pricing 是 AiCallLog 單價快照的來源——**用戶自報價格永不納入計費**。
- Guard：`capability-catalog-check` 驗證 JSON schema + modelKey 格式。該 guard 的 `CAP_KEYS` 是 `src/lib/ai/capabilities.ts` 中 `.strict()` zod schema 的硬編碼鏡像，**新增能力欄位必須同步兩處**，否則 CI 立即失敗。
- 注意 `modes`（`["i2v"]` 等）目前**不被任何邏輯讀取**，純為展示用 metadata；真正會被讀取的能力旗是 `supportsReferenceImages` 與 `supportsEndFrame`。

## 尾幀錨定（首尾幀）

生成 shot N 的影片時，起幀為 shot N 自己的分鏡圖，尾幀為 shot N+1 的分鏡圖；shot N+1 的影片再由同一張圖開始——兩段影片在接口處的畫格完全相同，剪接時零跳動。

- **不採用「抽取前一段影片末幀餵給下一段」的做法**：那會丟棄 shot N+1 精心組裝的分鏡圖（連同其身份參考、空間契約、風格詞），強制影片串行生成，且末幀本身帶動態模糊與編碼損耗、模型於片尾最易漂移，長鏈會累積走樣。`docs/plans/2026-08-03-storyboard-prompt-research.md` 已記錄「前鏡餵後鏡」是已知的身份漂移反模式。尾幀錨定所需的兩張圖在生成影片前皆已存在，因此**並行結構完全不變**。
- 能力旗：`capabilities.supportsEndFrame`。目前 Seedance 2.0 全家（mini／fast／正式版）已核實支援 optional `last_image`（含系統預設 mini）；fal Kling 的 `tail_image_url` 映射已寫好但**未標旗**（v3/standard 未經核實），核實後標旗即通電。
- 降級規則：模型未聲明 `supportsEndFrame` 時，`generateVideo` 靜默不傳尾幀並 `console.warn`，照常生成影片——**不 throw、不使鏡頭失敗**。尾幀是錦上添花的連戲手段，不值得因換 model 而令整批鏡頭失敗。
- 哪兩鏡可鏈由 `src/lib/storyboard/frame-chain.ts` 的純函數 `shouldLinkToNext` 確定性判定，於分鏡建立時寫入 `Shot.linkedToNext`。**判定刻意收窄至「本鏡本身是運動鏡頭（推／拉／搖／移／跟）」**：接口畫格相同會使剪接點變成連續運鏡，這對「中景推入變近景」是好事，但對正反打對話戲是災難——鏡頭會在片中途甩開自己的構圖游向下一鏡。跨場、跨閃回、跨閃回地點、非相鄰索引一律不鏈。

## 金鑰

- 解析順序（`getProviderKey(userId, provider)`）：user BYO key（`user_provider_keys`，AES-256-GCM，即時解密）→ env key（註冊表 `envKeyName`：`OPENROUTER_API_KEY` / `FAL_KEY` / `ATLASCLOUD_API_KEY`）→ `PROVIDER_KEY_MISSING`。Project 永不持有 key。
- **所有 adapter 皆經此函數取得 key**，guard 會掃描是否有直接讀取 `process.env.FAL_KEY` 出現於 adapter 以外的地方。
- API 永不回傳明文金鑰（BYO-Key 頁只顯示 last4；`/settings` 徽章：已連接·自備金鑰 / 已連接·平台金鑰 / 未連接）。
