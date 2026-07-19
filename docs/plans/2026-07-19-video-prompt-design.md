# 視頻 Prompt（image-to-video）設計

> 日期：2026-07-19｜作者：Kelvin + Claude
> 前置研究：三個參考 repo（huobao / Toonflow / waoowaoo）嘅 i2v 視頻 prompt 機制深挖（三份 dossier）
> 狀態：已確認設計

## 0. 問題

現況：`videoShotHandler` 用 `shot.videoPrompt || plan.subject || shot.imagePrompt` 當視頻 prompt——**冇專門嘅視頻 prompt 工程**。imagePrompt 係「單幀構圖」,唔係「時間 + 動作 + 運鏡」,拎去生片就得個靜態感/亂郁。

## 1. 三家共識（= 好嘅視頻 prompt 做法）

1. **視頻 prompt 由分鏡 LLM 一次過寫定，唔係生成時砌**。三家都咁做。camera/acting 係 metadata 欄,但真正入模型嘅係一條 LLM 寫好嘅 motion-ready 散文。
2. **image_prompt 同 video_prompt 硬分開**：image = 單幀構圖；video = 時間推進 + 動作變化 + 鏡頭語言。同一 agent 一次寫齊,唔可互相代替（huobao 明文）。
3. **情緒靠動作,唔用抽象詞**：❌「他很傷心」 → ✅「肩膀塌下，頭緩緩低垂」（三家都有）。
4. **時間分段時間軸**：huobao 3 秒一段 `<n>`；Toonflow `0s-Xs`；每段 = 時碼 + 景別 + 誰 + 具體動作。
5. **運鏡詞庫**：固定/推/拉/搖/跟/移 × 景別（遠/全/中/近/特），一套詞映射到各模型 idiomatic 講法。
6. **角色身份穩定**：video prompt 內用「年齡+性別」措辭指代角色（waoowaoo rule 4）,穩定 i2v 唔漂移。
7. **對白三分 + `silent` 標記**（Toonflow 最值抄）：dialogue（開口）/ OS 內心（閉嘴）/ VO 畫外（閉嘴/離畫）;每個唔講嘢嘅角色明確標 `silent`,防止多角色鏡頭生錯口型。
8. **動作真實靠供應商原生旋鈕 + 負面 prompt，唔靠散文**（waoowaoo）：Kling 用 `negative_prompt:'blur, distort, low quality'` + `cfg_scale:0.5`；Vidu `movement_amplitude`；Ark `camera_fixed`。試圖用文字寫「唔好變形」冇用。
9. **一鏡一運鏡 + single continuous take, no cuts + 不跳軸**（Toonflow）。
10. **首尾幀 = 另一個鏡頭嘅圖**：storyboardId+panelIndex 解析,重用同一圖 pipeline（waoowaoo）。

## 2. ReelCraft 優化方案（fal Kling stack）

我哋分鏡已有四階段（規劃/攝影/表演/細節）。優化：**喺分鏡輸出多產一條 motion-ready 嘅 `video_prompt`**,而唔係生成時 reuse image prompt。

### M1（核心）
1. **新增 storyboard 出 video_prompt** — storyboard_plan / detail 每鏡多輸出一個 `videoPrompt` 欄（英文,motion-ready），規則抄三家：
   - 具體可見動作、情緒靠動作、用「年齡+性別」指代角色。
   - 一鏡一運鏡；single continuous take。
   - 對白三分 + `silent` 標記非講話角色。
   - 存落 `shot.storyboardJson.video`（或新欄）。
2. **videoShotHandler 用 video_prompt** — 優先 `storyboardJson.video.prompt`,fallback 現有。
3. **fal Kling 加負面 prompt + cfg** — `falVideo` 加 `negative_prompt:'blur, distort, morph, low quality, deformed'`、Kling 系加 `cfg_scale:0.5`（能力目錄標明邊個 model 支援）。
4. **運鏡詞庫** — 分鏡 detail 已有 camera 欄,prompt 加映射表把中文運鏡翻成 Kling idiomatic 英文（push in / pull back / tracking / pan / static）。

### M2（增值）
1. **時間分段 motion 時間軸** — 長過 5 秒嘅鏡頭,video_prompt 用 `0s-Xs` 分段。
2. **首尾幀模式** — 鏡頭圖做首幀、下一鏡圖做尾幀,平滑過渡（能力目錄 gating，Kling 部分支援）。
3. **對白驅動口型** — 配音台詞已知邊個講,video prompt 自動標該角色 `speaking`、其餘 `silent`（接 lip-sync M3）。

### 刻意唔抄
- Seedance 12 維中文格式 / 9 維音色表 — 太 model-specific（Toonflow 為 Seedance 特製）,我哋主力 fal Kling 用簡潔英文 motion prose 就夠。
- @图N 綁定 — Kling i2v 係單圖,唔使多參 @图N（多參係多圖模型先要）。

## 3. 測試 / 驗收

- Canary：新 video_prompt 輸出鎖「motion-ready」規則字串（情緒靠動作、silent 標記、一鏡一運鏡）。
- E2E：生一個鏡頭 → 有獨立 video_prompt（唔等於 image prompt）→ Kling 出片,肉眼睇動作自然、無變形。
- 對比：舊（reuse image prompt）vs 新（motion-ready + 負面 prompt）嘅片。

## 4. 份量

- M1：storyboard prompt 加 video_prompt 欄 + handler 用佢 + fal 負面 prompt + 運鏡映射,約一薄片。
- M2：時間軸 + 首尾幀 + 對白口型,各一薄片。
