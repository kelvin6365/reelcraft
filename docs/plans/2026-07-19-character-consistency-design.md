# 角色一致性（Character Consistency）設計

> 日期：2026-07-19｜作者：Kelvin + Claude
> 前置研究：三個參考 repo（huobao-drama / Toonflow / waoowaoo）的角色一致性機制深挖（三份 dossier）
> 狀態：✅ 已實裝（img2img 參考圖鎖定 + 多視角 turnaround sheet + 自參考重生，A/B 對比驗證）

## 0. 問題

現況：`imageShotHandler`（src/lib/workers/handlers/media-handlers.ts）生成每個鏡頭圖時，**只傳文字 prompt，零參考圖**。角色在不同鏡頭獨立重畫 → 樣貌不一致。短劇最致命的質素問題。

## 1. 三家共識（= 正確做法）

全部用 **reference-image 條件生成（img2img）**，不用 seed / LoRA / embedding：

- 每角色一張 canonical「英雄圖」（正面、中性背景、素顏），重用於所有鏡頭。
- 每鏡收集有序參考陣列 `[出場角色圖…, 場景圖]`，只收該鏡真正出現的資產。
- 全部壓縮成 base64 data-URI（供應商無關；huobao 768px q68、上限 6）。
- prompt 用**數字**而非名稱綁定參考（`图片N` / `@图N`）+ 圖例 legend。
- 明文連續性條款：同一面孔/髮型/服飾 across ALL shots；只准改構圖/角度/動作/表情；不准加參考圖以外的新角色。

**fal 關鍵**（我們的 stack）：nano-banana 有參考圖時要用 `fal-ai/nano-banana/edit`（或 `nano-banana-pro/edit`）endpoint，參考圖放 body 的 `image_urls: string[]`；無參考時走 base（text-to-image）。

各家 payload 欄位：fal=`image_urls`、gemini=`contents.parts[].inline_data`、minimax/seedream=`image[]`。

## 2. ReelCraft 優化方案

「取三家之長」：waoowaoo 的 fal 落地 + Toonflow 的 `@图N`/continuity JSON + huobao 的壓縮正規化。

### M1（核心，直接解決問題）

1. **outbound 參考正規化** `src/lib/ai/outbound-image.ts`
   - 輸入 mediaId 陣列 → 逐個經 storage 取 buffer → sharp 壓成 ≤1024px JPEG → `data:image/jpeg;base64,…`。
   - dedupe、上限 6、**部分失敗容忍**（全部失敗才拋 `REFERENCE_ALL_FAILED`）。

2. **fal adapter 加 reference 支援** `src/lib/ai/adapters/fal.ts`
   - `falImage({…, referenceImages?: string[]})`：有 refs → endpoint `fal-ai/nano-banana/edit`、body 加 `image_urls: refs`；無 refs → 現有 base 路徑。
   - `generateImage` req 加 `referenceMediaIds?: string[]`，經 outbound 正規化後傳給 adapter。

3. **imageShotHandler 收集參考圖** `media-handlers.ts`
   - 該鏡 `storyboardJson.plan.characters`（名字）→ 對應 project 已鎖定角色（`locked && lockedImageMediaId`）。
   - 場景：該 scene 的已鎖定 location（v1 取第一個已鎖定 location，M2 做 per-scene 綁定）。
   - 有序 mediaId 陣列 `[char1, char2, …, location]` → 傳 `referenceMediaIds`。

4. **`image_prompt_shot` prompt v3** `prompts/pipeline/image_prompt_shot.zh.txt`
   - 傳入 `reference_legend`（`图片1=林知夏(角色)；图片2=咖啡店·夜(場景)`）。
   - prompt body 用 `图片N` 指代，不用名字。
   - 尾段固定 continuity 條款（抄 Toonflow Mode-B）：
     - 面孔/髮型/服飾與參考圖完全一致
     - 只可改：構圖、鏡頭角度、動作、表情
     - 光影/色調由場景參考圖決定，角色圖只提供身份
     - 不得引入參考圖以外的新角色

5. **光影 offload**：角色鎖定圖生成時 prompt 保持中性光（`generateAssetImages` 已用 style prefix；確認不加場景光）；鏡頭光影靠場景圖 + 鏡頭 prompt。

### M2（增值）

1. **自參考換裝** — `CharacterAppearance` 概念（v1 用 Character 單圖；M2 加 appearances[]）。canonical（index 0）純文字生成；其他 look 用 canonical 圖做 reference img2img → 換衫不換臉。
2. **四視圖 turnaround 表** — 角色 canonical 生成改用「正/側/背 + 特寫」多視圖 sheet（Toonflow art_character.md 規則）→ 最大化參考面、跨角度更穩定。用 `CHARACTER_ASSET_IMAGE_RATIO` 較寬比例。
3. **幀鏈**（huobao）— 若做首尾幀，尾幀把首幀當參考。
4. **空間一致性**（Toonflow）— storyboard 加 `orientation` + 3×3 grid + 180° 軸線欄，prompt 鎖每角色固定畫面側與朝向。

### 刻意不抄

- **seed 操作** — 三家都表示不靠 seed（ali 的 seed trick 只是無參考圖時的退化方案）。
- props 參考圖 — 短劇 props 少，v1 靠文字。

## 3. Schema 影響

- M1：**零 schema 改動**（用現有 `Character.lockedImageMediaId` / `Location.lockedImageMediaId`）。
- M2 自參考換裝：加 `Character.appearances Json`（或新 model），非必須，遇到痛點才做。

## 4. 測試 / 驗收

- 單元：outbound 正規化（壓縮/dedupe/上限/部分失敗）、參考收集（角色名→鎖定圖對應）、fal `image_urls`/edit endpoint 分支（mock fetch）、`image_prompt_shot` canary（含 continuity 條款字串）。
- fal 422 no_media_generated 已改可重試（前一輪修好）。
- E2E `scripts/smoke-consistency.ts`：真 fal，鎖定角色圖 → 生 2-3 個含同一角色的鏡頭圖 → 人眼/檔案存在斷言（自動化只能斷言 image_urls 有傳、endpoint 正確；一致性靠人工判斷）。
- **收貨**：同一角色在多個鏡頭生成出來，面孔/髮型/服飾肉眼一致（對比改動前每鏡各異）。

## 5. 份量

- M1：fal adapter + outbound 正規化 + handler 收集 + prompt v3 + tests，約一薄片。
- M2：自參考換裝 + 四視圖，各一薄片（schema 可選）。
