# 03 · Provider 層

鐵律：model 引用一律 `provider::modelId`；禁止 provider 猜測/靜態映射/預設降級；所有呼叫經唯一入口（04-audit.md）。

## 契約

```ts
type ModelKey = `${string}::${string}`          // 'fal::fal-ai/nano-banana-pro'
type ApiType = 'text' | 'image' | 'video' | 'tts'

parseModelKeyStrict(key): {provider, modelId} | null   // 冇 '::' 即 null，caller 必須 throw

interface TextAdapter  { complete(req: TextRequest): Promise<TextResult> }       // + stream 變體
interface MediaAdapter {
  submit(req: ImageRequest | VideoRequest | TTSRequest): Promise<{externalId} | {resultUrl}>
  poll(externalId): Promise<{status:'pending'|'done'|'failed', resultUrl?, error?}>
}
// TextResult 必含 usage {inputTokens, outputTokens}；MediaResult 必含 quantity（張/秒/字符）
// —— callModel() 靠呢啲寫 AiCallLog，adapter 唔提供 usage 係 bug
```

## Provider 註冊表（`src/lib/providers.ts`）

Provider 係一等配置實體（TS const，唔係 JSON——adapter/auth 本身係 code path）：

```ts
ProviderDef { id, label, envKeyName, authScheme: 'bearer'|'key'|'none', byok, devOnly }
PROVIDERS = [openrouter, fal, atlascloud, fake]   // v1 只內建；BYOK_PROVIDERS 由此派生
```

- `/api/models` 由註冊表 + 能力目錄組合出 picker feed：`{ providers:[{id,label,connected}], models:[…] }`。`connected` 只查 key **存在**（user key → `user-key`；env key → `env-key`；否則 `none`），唔 live ping。
- Guard：`provider-registry-check` —— 目錄入面每條 modelKey 嘅 provider 前綴必須喺註冊表；系統預設必須存在於目錄且 apiType 匹配；禁 `fake::pipeline` / `?? "fake::` 兜底 pattern 迴歸。

## 三層模型預設解析（`src/lib/model-defaults/resolve.ts`）

```
system（code 常數，真模型）← user（user_model_defaults 表，/settings 設定）← project（projects.modelDefaults）
按 apiType 逐項解析；最具體且【合法】（目錄有、apiType 啱）嘅一層贏；
非法項 log + 跳過落上層——永不靜默降級去 fake（鐵律 #3）。
```

- 系統預設：text=`openrouter::google/gemini-2.5-flash-lite`、image=`fal::fal-ai/nano-banana-pro`、video=`fal::fal-ai/kling-video/v3/standard/image-to-video`、tts=`fal::fal-ai/minimax/speech-02-hd`。
- **解析喺 run time**（worker `resolveTaskModels`）——唔 snapshot 落 task payload（會炸批量 dedupeKey 確定性 + 重試 UX）。billing（quote/budget）行同一 resolver，報價同執行一致。
- Dev/CI 冇 key：env `MODEL_DEFAULTS_PRESET=fake` 顯式將 system 層換成 fake::*（顯式配置，唔算降級）。**生產必須留空。**
- 站 UI（圖像/視頻站 header chip）顯示解析結果 + 單價；fake 亮橙色警告。

## MVP 三個 adapter

### openrouter（text 全包）
- OpenAI SDK 指向 `https://openrouter.ai/api/v1`；一把 key。
- 串流：SSE delta 直通 `task_events`。usage 由 response 尾包攞。
- 起步 model：分析/抽取用平嘅（`deepseek/…` 或 `google/gemini-flash`），分鏡四階段用好嘅（`anthropic/claude-sonnet-*`）——邊個崗位用邊個 model 存 `projects.modelDefaults`，用 AiCallLog 數據調。

### fal（媒體主力）
- Queue API：`POST https://queue.fal.run/{modelId}` → `{request_id}` → poll `/requests/{id}/status`。
- image：nano-banana 系；video：Kling / Wan / Veo（i2v 為主，首尾幀模式 M2）；TTS：IndexTTS-2（reference audio 聲音克隆）；lip-sync M2。
- 參考圖入 request：MediaObject 簽名 URL（fal 拉得到公網 URL 就唔使 base64）。

### atlascloud（媒體副選）
- 同樣「提交→輪詢」聚合器形態，adapter 結構抄 fal 個殼。
- 用途：國內模型（豆包/可靈/Vidu 系）+ 價格 A/B + fal 故障 fallback。
- Fallback 規則：**只喺 submit 階段 fail（唔係生成質素差）先自動切**，且寫 audit；生成中途唔切。

## 能力目錄（`standards/capabilities.json`）

```json
[{ "modelKey": "fal::fal-ai/kling-video/v3/standard/image-to-video",
   "apiType": "video",
   "capabilities": { "durationsSec": [5, 10], "resolutions": ["720p","1080p"],
                     "modes": ["i2v"], "aspectRatios": ["9:16","16:9"] },
   "pricing": { "mode": "flat", "perUnit": 0.28, "unit": "second", "currency": "USD" } }]
```

- 提交任務時校驗選項合法（唔合法即 throw，唔好落到 provider 先炸）。
- pricing 係 AiCallLog 單價快照來源——**用戶自報價格永不入計費**。
- Guard：`capability-catalog-check` 驗 JSON schema + modelKey 格式。

## 金鑰

- 解析順序（`getProviderKey(userId, provider)`）：user BYO key（`user_provider_keys`，AES-256-GCM，即時解密）→ env key（註冊表 `envKeyName`：`OPENROUTER_API_KEY` / `FAL_KEY` / `ATLASCLOUD_API_KEY`）→ `PROVIDER_KEY_MISSING`。Project 永不持有 key。
- **所有 adapter 經呢個函數攞 key**，guard 掃直接 `process.env.FAL_KEY` 出現喺 adapter 以外。
- API 永不回傳明文金鑰（BYO-Key 頁只顯示 last4；`/settings` 徽章：已連接·自備金鑰 / 已連接·平台金鑰 / 未連接）。
