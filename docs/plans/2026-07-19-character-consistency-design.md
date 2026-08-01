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

## 6. 後續演進（2026-07-26，本文檔以上內容為歷史設計原文，不改寫）

M1 落地後再迭代出以下機制，均圍繞「令參考圖更準」呢個核心目標：

- **近臉特寫改手動觸發**：原設計無提及，實作初期鎖定資產會自動提交近臉特寫任務；現改為使用者手動按「近臉」才生成（`lock` route 不再自動 submit），shot 生成本身容忍缺少 `faceImageMediaId`。理由：自動生成會在使用者未準備好時消耗一次生成額度，亦令鎖定動作的意圖變得混雜。
- **墊臉（`refFaceMediaId`/`refFaceNote`）**：角色資產可上載一張參考臉相＋補充要求，生成候選圖時排第一張 reference（`keepIdentity` 鎖定圖排第二），令新角色候選圖從第一輪即跟隨指定的臉，無須鎖定之後再碰運氣。
- **場景多視角**：`Location.angles`（extract_assets v3 判斷重要場景建議 ≥2 個視角，逐張手動生成單圖，比例跟 `project.videoRatio`）。⚠️ 本條原文寫「已接入 `buildShotRefAssets`」，**已不成立**：參考圖配額收緊至 3 格（1 場景主視角 + 2 角色）之後，場景視角圖不再進入鏡頭參考圖序列，`buildShotRefAssets` 只取場景主視角。場景視角圖現時的用途是給使用者確認空間一致性，以及作為場景主圖之外的人手參考。
- **`MAX_SHOT_REFS = 6` 顯式截斷**：因應下游 provider 對參考圖數量有硬上限，在 legend 編號前截斷，避免圖例與實際送出圖片錯位。

詳細機制見 `docs/tech/06-prompts.md`（鏡頭參考圖組裝、prompt 版本）同 `docs/tech/01-data-model.md`（`refFaceMediaId`/`angles` 欄位）。

## 7. 角色資產圖改版（2026-07-28）

角色生圖原本一次過生成「多角度設定表（turnaround sheet：正面／側面／背面 + 面部特寫拼一張）」候選圖，改為與 `Location.angles` / `Prop.views` 一致的模式：

- 角色生成只出**一張**全身正面候選圖（`Character.candidates` 長度由 3 變 1），使用者揀圖鎖定後即為主圖。
- 鎖定主圖後，新增 `Character.views`（`[{label, prompt, mediaId}]`，同 `Location.angles`/`Prop.views` 同一形狀），預設含「側面」「背面」兩個空位，各自按需要逐張手動生成，以鎖定嘅正面圖做參考圖鎖定身份。
- 已鎖定嘅角色不能再重生主圖，需先解鎖（同 Location/Prop 一致的 `LOCKED` guard）。
- 鏡頭參考圖組裝（`buildShotRefAssets`）依序帶入：正面全身 → 面部特寫 → 已生成嘅側面/背面視角，圖例標籤相應由「角色全身多視角」改為「角色全身正面」。
- `image_prompt_shot` prompt（v8）措辭配合更新：角色參考圖唔再係單一設定表，而係一批獨立圖（正面／側面／背面／面部特寫），AI 需按本鏡頭機位揀最貼合嗰張。

## 8. 場景資產改原生豎構圖（2026-08-01）

場景主圖與場景視角圖原本硬編碼 `aspectRatio: "16:9"`（主圖見 commit `d204865`，理由只留在 commit message，無設計文檔），現一律改為跟 `project.videoRatio`。

**診斷過程**：分鏡出圖出現燒死的黑邊 24/37。隔離實驗（同一鏡頭、同一 prompt，只更換參考圖）：

| 參考圖 | 黑邊高度 |
|---|---|
| 無參考圖 | 472px |
| 16:9 場景圖**裁切**成 9:16 | 327px |
| 原生 9:16 場景圖 | **0px** |

**關鍵結論——問題不是比例，是構圖。** `outbound-image.ts` 的 `planEncode` 一直已經把非 `identityAnchor` 的參考圖裁切到目標比例（實測 1344×768 → 432×768），所以送到 provider 的那張本來就是 9:16。真正的變數是：橫向 vista 經中央裁切丟棄 68% 畫面，模型收到半截構圖後會自行重建一個開闊場景再 letterbox；原生豎構圖則不會。因此**事後裁切無法取代原生豎構圖**，不要因為「反正會裁」而把 16:9 改回去。

連帶改動：

- `location-angles.ts` 的 `ANGLE_REF_FRAMING`（append 到每一張場景主圖）由 `wide establishing reference view` 改寫為縱向取向的 establishing 描述。原句是整條場景 prompt 中最強的橫構圖信號，與 API 的 `aspect_ratio` 直接衝突。
- 場景視角圖同步跟 `project.videoRatio`：視角圖是圖生圖、以主圖做唯一參考，9:16 主圖配 16:9 目標會令視角圖自己 letterbox。
- `buildShotRefAssets` 的排序（場景在前、角色在後）維持不變，但理由改變：不再是「讓最後一張是 9:16」，而是「讓 identity anchor 最貼近輸出」。
- UI（`AssetsPanel`）候選圖格與視角縮圖改為按資產類型取比例，不再一律 `aspect-video`。
- 參考圖配額現時為 `MAX_SHOT_REFS = 3`（1 場景 + 2 角色），第 6 節所述的 `= 6` 已過時。

## 9. 外貌描述內容過濾（2026-08-01）

`image_prompt_shot` 模板要求角色外貌「照譯勿改寫」逐字帶入，所以 `Character.appearancePrompt` 的原文會原封不動送到出圖 provider。實測有角色的外貌描述含「露出许多皮肤（尤其是腰部）」，觸發 `HTTP_422 content_policy_violation`，整個鏡頭 terminal fail。

新增 `src/lib/prompts/appearance-filter.ts`，在組裝 `locked_assets` 之前過濾，分兩層：

1. **整句丟棄**：整句的重點就是裸露程度、不含任何身份資訊（如「露出许多皮肤（尤其是腰部）」、「半裸」、「事业线」、`revealing` / `scantily clad` / `exposed midriff` / `cleavage`）。
2. **只刮形容詞**：風險形容詞附著在有用的句子上（「性感的黑色旗袍」→「黑色旗袍」；`a seductive red qipao` → `a red qipao`）。

原則是**只剝審查詞，不剝身份錨**：服裝、髮色、髮型、配件、體型、年齡是角色跨鏡一致性的唯一文字載體，剝掉等於主動製造角色漂移，比 422 更難察覺。所以兩層 pattern 都刻意寫窄——寧願漏網一句去到 provider 吃 422（可見、可查、可補 pattern），也不要靜靜吃掉角色的服裝描述。命中時 `console.warn` 留痕（帶資產名 + 剝走的原文 + 送出版本）。
