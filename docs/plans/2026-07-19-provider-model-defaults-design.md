# 供應商註冊表 + 三層模型預設（Provider Registry & 3-Layer Model Defaults）設計

> 日期：2026-07-19｜狀態：✅ 已實裝（PR1-4 全落地：resolver + user 層 + picker + 站 chips；190 測試、10 guards 全綠；PR5 mediaAdapters 清理未做）｜作者：Kelvin + Claude
> 目標：解決「project 靜默用 fake::video 出空片」一類問題——model 預設要有系統層兜底真模型、用戶可設個人預設、project 可覆寫；provider 成為一等配置實體（連接狀態、按 provider 分組嘅 model 列表）；站 UI 顯示即將使用嘅 model + 單價。
> 前置研究：三個參考 repo（huobao/Toonflow/waoowaoo）嘅 provider/model 配置模式；本 repo 現況探索（capabilities.json、getModelDefaults、BYOK 流程）。

## 三層解析鏈（核心）

```
system default（code 常數，真模型）
  ← user default（新表 user_model_defaults，/settings 設定）
    ← project override（現有 projects.modelDefaults）
按 apiType（text/image/video/tts）逐項解析，最具體且【合法】嘅一層贏。
非法項（唔喺 catalog / apiType 唔啱）→ log + 跳過，落返上一層——永不靜默降級去 fake（鐵律 #3）。
```

系統預設（已確認用真模型）：

| apiType | 系統預設 |
|---|---|
| text | `openrouter::google/gemini-2.5-flash-lite`（catalog 已有；同時補 `openrouter::google/gemini-2.5-flash` entry，因現有 project 用緊） |
| image | `fal::fal-ai/nano-banana-pro` |
| video | `fal::fal-ai/kling-video/v3/standard/image-to-video` |
| tts | `fal::fal-ai/minimax/speech-02-hd` |

Dev/CI 冇 key：`MODEL_DEFAULTS_PRESET=fake` env — **顯式配置**將系統層換成 fake::*（唔係靜默降級）；smoke scripts 同 dev .env 設呢個。

## 決策表

| 問題 | 決定 |
|---|---|
| Provider registry 存邊 | TS const 喺 `src/lib/providers.ts`：`ProviderDef { id, label, envKeyName, authScheme, byok, devOnly }`。唔放 JSON——adapter/auth 本身係 code path。`BYOK_PROVIDERS` 由佢派生（export 形狀不變）。`capabilities.json` 只管 model；`template::` 維持路由前綴，唔係 provider。 |
| v1 自定 provider | ❌ 唔做（只內建 openrouter/fal/atlascloud/fake）。OpenAI-compatible 自定 endpoint 留後續 milestone（只准配置式，唔准可編程 vendor——Toonflow 教訓）。 |
| Media routing 重構 | 最小化：`generate-media.ts` 內 fal/atlascloud if-chain 收斂做本地 `mediaAdapters` map；未知 provider → 查 registry 即拋 `PROVIDER_UNKNOWN`。完整 MediaAdapter interface 留 PR5（可選）。 |
| User 預設存邊 | 新 sidecar 表 `user_model_defaults`（userId PK → User cascade，`defaults Json`）——跟 UserProviderKey 模式，唔郁 Better-Auth 嘅 users 表。 |
| 解析時機 | **維持 run time**（worker 內經新共用 resolver）。唔喺 enqueue snapshot 落 payload：會炸批量 dedupeKey 確定性（advance 靠 `{at:0}` payload hash 防重複）、炸「改 model 後重試」UX；billing reserve→settle 本身容忍漂移。Worker log 解析結果 + 邊層贏。 |
| Key 解析 | 不變：user key → env key（registry `envKeyName`）→ `PROVIDER_KEY_MISSING`。Project 永不持有 key。 |
| 同 model 多 provider 路由優先級 | 留後續（v1 用戶直接揀完整 `provider::modelId`）。 |
| 每 shot 覆寫 | ❌ 唔做，project 級係啱嘅粒度。 |

## 順手修嘅 bug

- `getModelDefaults` text 兜底係 `fake::pipeline`——catalog 根本冇呢條 key（正確係 `fake::text`）。新 resolver 直接淘汰成個 fake 兜底。
- PATCH /api/projects/:id 寫 modelDefaults 零驗證 → 加 `validateDefaultsPatch`（key ∈ 四 modality、`parseModelKeyStrict` 通過、catalog 有 entry、apiType 匹配）。

## 實作（薄片順序）

1. **PR1 — resolver 核心 + bugfix + guard**（冇 migration）：`src/lib/providers.ts` registry；`provider-key.ts` envKey 改查 registry；新 `src/lib/model-defaults/resolve.ts`（SYSTEM_MODEL_DEFAULTS / resolveModelDefaults / validateDefaultsPatch / PRESET）；`workers/handlers/shared.ts` 換 async resolver（全部 call site）；`billing/quote.ts` resolveModels + `billing/budget.ts` 行同一 resolver（穿 userId）；catalog 補 gemini-2.5-flash；新 guard `scripts/guards/provider-registry-check.mjs`（catalog provider 前綴 ⊆ registry、系統預設必在 catalog、禁 fake 兜底 pattern 迴歸）。⚠️ 行為變更：空 modelDefaults 嘅 project 由免費 fake 變真模型報價/生成。
2. **PR2 — user 層 + settings UI**（migration `add_user_model_defaults`，跑完**重啟 web + worker**）：resolver 讀 user 行；`/api/user/model-defaults` GET/PUT（驗證 + audit）；`/api/models` GET（providers 連接狀態〔user-key/env-key/none，只查存在唔 live ping，永不回 key 材料〕+ model 目錄連單價）；/settings 加「預設模型」card（4 picker）+ ProviderKeyRow 連接徽章。
3. **PR3 — project picker 泛化**：`ModelPicker.tsx` 四 modality、按 provider optgroup、按 capabilities（videoRatio/resolution）+ key 可用性 disable、未設顯示「(系統預設)/(個人預設)」；換 image model 且已有生成圖 → 軟警告（唔 block）；PATCH 加驗證。
4. **PR4 — 站 chips**：episodes GET cost 加 `activeModels`（modelKey + 單價）；`ImagesPanel`/`VideosPanel` header chip，例 `🎬 kling-v3 · ~$1.40/鏡`（重用 StoryboardPanel cost-preview 樣式）。
5. **PR5（可選）— mediaAdapters map 清理** + 路由完整性測試。

## 測試/驗收

- 單元：解析優先級（system/user/project、逐 modality 獨立）、非法項落層唔落 fake、validateDefaultsPatch 驗證矩陣、PRESET 行為；quote 由系統預設出非零報價；batch payload 維持 `{at:0}`（no-snapshot 迴歸鎖）；/api/models 永不漏 key 材料。
- E2E：真 key + 冇 PRESET → 新 project 空 defaults → 站 5/6 chip 顯示 nano-banana-pro / kling-v3 連單價 → 真路徑各生成一張圖一條片；/settings 設 user default = fake::video → chip 即轉、下次生成係 fake。
- 收貨：任何 project 唔會再靜默用 fake 出空片；用戶一眼喺站 UI 見到用緊咩 model 同幾錢一鏡。

## 風險

- **計費行為變更**（PR1 最大）：ENFORCE 模式零餘額用戶會見 `INSUFFICIENT_BALANCE`；冇 key 嘅 dev 見 `PROVIDER_KEY_MISSING`。緩解：dev/CI 設 `MODEL_DEFAULTS_PRESET=fake`（.env.example 要同步——env-example-sync guard）+ release note。
- 報價/執行漂移（enqueue 後改 default）：接受，settleFreeze 對數。
- 連接狀態只查 key 存在（revoked key 照顯示已連接）：v1 接受，live 測試掣已有。
- Migration 後 Prisma client 過期：兩個 process 都要重啟。
