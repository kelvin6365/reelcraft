# 交付標準落地設計（Delivery Standards）

**狀態**：草案 · 標準收集中
**日期**：2026-08-03
**來源**：外部短劇代工廠《交付標準》教學投影片（五版，共四章標準）

---

## 一、這份文件是什麼

外部短劇生產團隊的**驗收標準**，是行業內經過大量退件累積出來的硬性規格。本文件把每一條標準拆解成：**對應 pipeline 站點 → 執行層 → 現況 → 缺口**，作為後續實作的單一真相來源。

實作分片一律對住本文件交付；本文件不描述實作細節（那些落在 `docs/tech/`），只描述「要達到什麼」與「靠什麼機制達到」。

### 定位邊界

- 本文件的標準**不等於 provider content policy**。兩者的交集（例如暴露度）會分別觸發不同後果：違反交付標準 = 客戶退件；違反 content policy = `HTTP_422` 生成失敗。設計時要分開處理，不可混為一談。
- 部分標準（第二章女頻本要求）**只在特定題材下適用**，不得無差別套用。見 §3.3。

---

## 二、核心原則：三層執行模型

**單靠 prompt 講規則是擋不住的。** 這是本專案已有的實證結論，不是預設立場：

> `image_prompt_shot.zh.txt` 內含完整的「無名群眾」規則段落（連反面例子「實測『夏雨戰隊』出咗四個一模一樣嘅金髮騎士」都寫進去了），`plan.subject` 另外再附加一次 `CROWD_DIRECTIVE`（`text-handlers.ts:341`）。**兩層都講了，模型照樣整段丟棄**，然後真的產出四個一模一樣的金髮紅甲女（episode `019fb890…51907` 鏡 25）。

`text-handlers.ts:266` 早已寫下同樣的結論：

> 同 ≤2 同框（違反率 13.5% → 0）、時序詞（→ 0）一模一樣：prompt 擋唔住嘅嘢，喺 handler 做確定性改寫先至真係 0。

因此每一條標準都必須明確指定它落在哪一層：

| 層 | 機制 | 適用 | 可靠度 |
|---|---|---|---|
| **L1 · prompt 約束** | `prompts/pipeline/*.txt` 內的規則與自我檢查 | 需要模型理解語意才能執行的（例如「外貌只寫看得見的東西」） | 中——會被丟棄 |
| **L2 · code 確定性守衛** | handler 在 `callModel()` 之後驗證／改寫／重試 | 可以程式化判定的（例如「核心特徵字串有沒有出現在輸出裡」） | 高——可達 0 違反 |
| **L3 · 資料層** | `prompts/styles/*/style.json` 的 `negativePrompt` / `bannedWords`、schema 欄位 | 負面詞、風格底線、結構性約束 | 高 |

**設計規則**：凡是可以程式化判定的標準，一律要有 L2。L1 只負責讓模型第一次就寫對（成本低、句子完整），L2 負責保證它真的對了。兩者不是二選一。

### 2.1 已驗證的反面教訓

三次失敗都指向同一件事——**在下游對自然語言做字串手術，必然失敗**：

1. **appearance-filter**（已刪除，commit `483322d`）：事後剝除審查詞，會連核心特徵一起改走。
2. **集體名詞 inline 替換**（已推翻，commit `4f2d812` → `0f6cae9` → `7380437`）：連撞三次爛句——換掉引號內的系統訊息、前綴吃不乾淨、相鄰命中貼出兩句。
3. **改為附加指令**（現行，commit `7380437`）：句子完整了，但指令被下游模型整段丟棄——即鏡 25。

**結論**：規則要落在**產生內容的那一刻**（L1，源頭寫對），驗證要落在**內容產生之後**（L2，確定性檢查），中間不要做字串改寫。

---

## 三、標準逐條落地

### 3.1 第一章 · 人物形象審核標準

| # | 標準原文 | 站點 | 層 |
|---|---|---|---|
| 1.1 | 人物整體形象（服飾、髮型、神態、氣質）需嚴格貼合劇本設定及人物小傳，核心特徵不得偏離 | `extract_assets` / `image_prompt_shot` | L1 + L2 |
| 1.2 | 不能出現龍紋、警徽等敏感標誌 | style pack | L3 |
| 1.3 | 人物禁止長得太像（AB 兩個角色雷同太多） | 資產鎖定 | L2 |
| 1.4 | 允許對非核心細節進行合理優化調整，調整後需同步記錄優化說明 | 生圖失敗重試 | L2 |
| 1.5 | 人物核心辨識度標識（專屬配飾、標誌性髮型、獨特神態）需完整保留 | `image_prompt_shot` | L2 |

#### 現況

**1.1 — 部分達成，但外貌欄位混入非視覺內容。**

`extract_assets.zh.txt` 對場景 `description` 有極嚴格禁令（禁人物、代詞、動作動詞、情緒詞，附自我檢查與反面例子），但對角色 `appearance` **沒有任何同級禁令**，只規定了字數與「以性別開頭」。實證污染：

```
王楚 profile：男，18岁，原游戏宅，穿越至游戏世界，游戏理解和操作技术高超，
              黑发黑瞳，相貌英俊，身材修长又结实。
```

中段是人物小傳，不是外貌，卻整串當作「凍結外貌文本」餵進生圖。後果：`image_prompt_shot` 面對一半畫不出來的內容，只能摘取，核心特徵（黑髮黑瞳、修長結實、休閒裝）在這一步蒸發成「黑髮黑瞳少年」——鏡 25 產出的是一個約二十五歲、穿現代連帽衫的男人。

**1.2 — 零覆蓋。** 四個 style pack 的 `negativePrompt` / `bannedWords` 全部只有畫質類詞（`film grain`、`deformed hands`、`text`、`watermark`），沒有任何一個提及龍紋、警徽、軍警標識、國旗國徽。奇幻題材（甲冑紋章、隊徽）誤觸頻率高。

**1.3 — 零守衛。** 本專案五個角色的髮色恰好全部不同（金／藍／粉／白／黑），另有種族分層（天使族羽翼、精靈族尖耳）與標誌武器，但這是 LLM 抽取的運氣，沒有任何 code 驗證過「AB 兩角色核心特徵是否重疊」。此標準在第一章、第四章各出現一次，共兩次——屬行業高痛點。

> ⚠️ **2026-08-04 用戶決定：`HTTP_422` 不處理。** 「422 唔洗理，預左，過色會 Block」——
> 帶審查詞的角色生圖失敗屬預期行為，**不要**做降級重試、不要自動剝除非核心細節去換取通過。
> 下面 1.4 的分析保留作記錄，但「422 降級重試」一項已從實作計劃移除（見 §5）。
> 核心／非核心分層仍有價值，但價值來自標準 2.2 的「得體服飾改寫」，不是繞過 content policy。

**1.4 — 機制不存在，且現況走了極端。** `media-handlers.ts:349-352` 明文寫死：

> 外貌文本**原文照送，一個字都唔改**（用戶決定，2026-08-02）……帶審查詞嗰啲鏡會直接食 HTTP_422 content_policy_violation 而 fail —— 用戶明知，寧願 fail 都唔要被改寫過嘅外貌。

本專案五個角色中三個帶審查風險詞（見 §3.2）。標準 1.4 提供的正是第三條路：

| | 做法 | 問題 |
|---|---|---|
| 舊 | appearance-filter 剝除審查詞 | 會連核心特徵一起改走（已刪除，正確） |
| 今 | 原文照送 | 一個非核心配飾令整鏡 fail |
| **1.4** | **核心永不動，非核心可捨棄 + 記錄優化說明** | — |

投影片舉例（粉色裙子 + 黑色漁網襪 → 捨棄漁網襪、保留裙子、記錄說明）與「露出许多皮肤」結構完全相同：**裙子＝核心，漁網襪＝非核心**。

**1.5 — 有規則、無驗證。** `image_prompt_shot.zh.txt` 寫明「原樣照抄，一個字都唔准改」，但沒有任何機制驗證是否照抄了。鏡 25 即實證：王楚只剩「黑髮黑瞳少年」，鄭夏雨（在 `plan.characters` 內、在 `scene.blocking` 內、有 Image 2 參考圖）**整個角色從 prompt 消失**。

---

### 3.2 第二章 · 女頻本人物要求

| # | 標準原文 | 站點 | 層 |
|---|---|---|---|
| 2.1 | 所有女角色（含正派、反派）嚴禁暴露、低俗設計，不得出現露胸、露腰、露腿過度 | `extract_assets` | L1 |
| 2.2 | 可呈現良好身材曲線，但需通過得體服飾展現，避免刻意凸顯身體部位，側重優雅、靈動、颯爽等符合女頻審美氣質 | `extract_assets` | L1 |
| 2.3 | 暴露程度不得超出「輕微露肩、露腳踝」範圍 | `extract_assets` | L1 + L2 |
| 2.4 | 所有女角色（含反派）不得醜化，須具備一定美觀度，氣質貼合角色設定（反派可冷艷、凌厲，但不可猥瑣、畸形） | style pack + 氣質層 | L1 + L3 |
| 2.5 | 所有男角色（含正派、反派）必須保證顏值在線，具備清晰辨識度，無醜化、無畸形，五官立體、比例協調 | style pack | L3 |

#### 現況

**2.1 / 2.2 / 2.3 — 本專案三個角色違反：**

| 角色 | 現時 profile 片段 | 違反 |
|---|---|---|
| 鄭夏雨 | 露出许多皮肤（尤其是**腰部**） | 2.1 露腰、2.3 超出「輕微露肩、露腳踝」 |
| 李雪晴 | 露肩（**露半胸**） | 2.1、2.3 |
| 安吉拉 | **胸部极大** | 2.2 刻意凸顯身體部位 |

注意 2.2 要求的**不是刪除而是改寫**：得體服飾展現曲線 + 氣質詞。§3.1 的「核心／非核心」分層處理得了「漁網襪」那一類（可直接捨棄），處理不了這一類。

**2.4 / 2.5 — 零覆蓋。** 四個 style pack 的 `negativePrompt` 都沒有 `ugly`、`disfigured`、`asymmetrical face`、`crooked features` 一類詞；`assetPrefix` 也沒有任何顏值／五官相關的正面詞。

**2.4 另有結構缺口——氣質層不存在。** 標準特別指出「反派可冷艷、凌厲」，即氣質須跟角色設定走，而非一刀切「美」。但現行組裝是：

```ts
// text-handlers.ts:462
appearancePrompt: `${c.appearance} ${c.wardrobe}`.trim()
```

**完全沒有氣質層。** 李雪晴的「狐媚眼」被塞進外貌欄，鄭夏雨的「冷漠、嚴肅」只留在 `bio.personality`，從未進入任何生圖 prompt。

#### 適用範圍（重要）

本章**不得無差別套用**。本專案原文為「18+ 二游《全球武考》」男主爽文，屬男頻，強套女頻標準等於擅自改走用戶要的東西——正是 appearance-filter 被刪除的原因。

**設計決定**：本章規則由 project 層明示開關控制。

```prisma
// Project
deliveryProfile String @default("none")  // 'female-audience' | 'male-audience' | 'none'
```

用戶選「女頻本」＝主動要求執行本章；選 `none` 則一個字都不動。這使規則從「系統擅自審查」變成「用戶下單的交付規格」，是上次翻車的根本解藥。

**執行位置必須在抽取時，不可在下游過濾**（見 §2.1）。事後剝除「露出许多皮肤」會產生爛句並損及核心特徵（紅色輕型甲胄）；在 `extract_assets` 落規則，LLM 會直接寫出「紅色輕型甲胄，腰側收窄剪裁，颯爽」——句子完整、核心特徵保住、氣質到位。

---

### 3.3 第三章 · 光影效果審核標準（嚴格執行）

| # | 標準原文 | 站點 | 層 |
|---|---|---|---|
| 3.1 | 嚴禁「陰陽臉」「半邊臉死黑、半邊臉過曝」；光影過渡柔和自然，無硬邊、無斷層；避免詭異發光、局部光斑突兀 | `storyboard_photography` + style pack | L1 + L3 |
| 3.2 | 光影層次清晰，明暗對比合理；保證人物面部細節可見，又能突出輪廓、營造氛圍；不出現過暗、過亮導致的細節丟失 | `storyboard_photography` | L1 |
| 3.3 | 禁止奇怪色塊、光影畸變；光影方向需統一（場景光源在左側，人物陰影需對應左側），避免邏輯混亂 | **`Scene` 光線契約** | **L2** |
| 3.4 | 人物皮膚光影自然，無油膩感、無過度反光，貼合皮膚質感，避免「塑料感」「假面感」 | style pack | L3 |

#### 現況

**根本問題：`storyboard_photography.zh.txt` 是整條 pipeline 最單薄的 prompt。** 攝影規則只有四行，光線規則只有一句：

> 光線：指明光源方向、硬柔、冷暖，服務場景情緒。

沒有質量下限、沒有面部可見性保護、沒有跨鏡一致性、沒有自我檢查。相較 `extract_assets` / `storyboard_plan` / `image_prompt_shot` 動輒數十行硬性規則加反面例子，光影這一層基本上無人看守。四條標準全部踩在這個洞上。

**3.1 — 系統主動下單訂了一張陰陽臉。** 鏡 25 的 `photography` 欄位：

```
lighting: 「來自王楚的無形力量，光效為冷白色，瞬間切斷連接，冷色調，高亮度。」
tone:     「高對比度，冷色調，強調力量感。」
```

單一強冷光源 + 高對比 + 高亮度 = 教科書級陰陽臉配方。產出圖中王楚半邊臉明顯偏暗，而「詭異發光」（手前的藍白光渦）也由同一句寫出。

負面詞覆蓋率：`cinematic-01` 有 `blown highlights`、`kdrama-01` 有 `harsh shadows`，**`anime-01` 與 `3d-01` 零覆蓋**。四個 pack 都沒有 `half-lit face`、`hard-edged shadow`、`banding`、`harsh split lighting`。

**3.2 — 無機制。** `photography.focusFace` 只在 `dof=shallow` 時指定哪張臉保持清晰，與曝光無關。`tone` 容許「高對比度」而無下限保護。

**3.3 — 結構缺口，且已有現成的正解模式。**

本專案已有 `Scene.blocking` 空間契約（`schema.prisma:170-172`），`shot-blocking.ts` 明確寫道：

> `cameraAxis` 唔過濾 —— 180 度軸線係**成場共用**嘅，佢正正就係跨鏡連戲嘅唯一依據，剝走佢等於親手拆咗連戲。

**光線缺了完全對應的那一份。** `lighting` 由 `storyboard_photography` 逐鏡各自撰寫，同一場戲每鏡的光源方向可以完全不同——正是標準 3.3 所指的「邏輯混亂」。這是**跨鏡**問題，逐鏡 prompt 在結構上永遠擋不到，與軸線必須一場一鎖是同一個道理。

**設計決定**：`Scene.blocking` 增設 `keyLight` 契約。

```ts
interface SceneBlocking {
  cameraAxis?: string;
  positions?: BlockingPosition[];
  keyProps?: string[];
  keyLight?: {           // 新增
    direction: string;   // 「畫面左前方」
    quality: string;     // 硬光 | 柔光
    temperature: string; // 冷 | 中性 | 暖
    motivation: string;  // 「陰雲透光」——光源的敘事來源
  };
}
```

由 `storyboard_plan` 一次過鎖定，逐鏡繼承。**與 `cameraAxis` 一樣不做逐鏡過濾**（`filterBlockingForShot` 需相應豁免）。僅在劇情明示光源改變（開燈、爆炸、日落）時允許偏離，該偏離須由鏡頭層明示標記，機制參照 `Shot.flashback`。

**3.4 — 有真空地帶。** `cinematic-01` / `kdrama-01` 的 `assetPrefix` 已寫得正確（`raw unretouched skin texture with visible pores, no beauty-filter smoothing`）。但：

- **這些詞只存在於 `assetPrefix`（人物資產圖），鏡頭圖使用的 `prefix` 一個都沒有。** 即鎖定圖皮膚正確，一出鏡頭圖就失效——而觀眾看到的是鏡頭圖。
- `3d-01` 方向相反：`assetPrefix` 寫 `clean smooth rendering with polished edges`，正是塑料感的配方；`negativePrompt` 只有 `plastic dead eyes` 兜不回來。
- `anime-01` 零皮膚質感詞。

---

### 3.4 第四章 · 人物資產 · 精品級硬性標準

| # | 標準原文 | 站點 | 層 |
|---|---|---|---|
| 4.1 | 顏值與氣質不幼稚：五官比例成熟、線條乾淨，拒絕幼態臉、未成年、過度大眼；體型符合年齡與身份，不誇張畸形 | style pack | L3 |
| 4.2 | 面部絕對統一（核心）：換髮型、換服裝時保持面部完全一致；膚色、冷暖調完全一致，禁止換一套衣服就像換了一個人 | `character-views` | L1 + L3 |
| 4.3 | 服裝風格、季節嚴格匹配人設；不出現透視、穿模、結構崩壞、不過審；人體結構正確 | style pack | L3 |
| 4.4 | 人物雙手自然下垂、正視圖、**人物手上不攜帶武器**、白色背景圖 | `character-views` + `extract_assets` | L1 + L2 |
| 4.5 | 除非有標注，不能出現龍紋、警徽等敏感標誌；人物禁止長得太像 | 同 1.2 / 1.3 | L2 + L3 |
| 4.6 | 區分開 2d、3d | `stylePackId` | ✅ 已達成 |
| 4.7 | 主角要有辨識度，主要角色都有面部特寫 | `faceImageMediaId` | ✅ 已達成 |

#### 現況：已達成的部分

`character-views.ts:17` 的 `CHARACTER_FRONT_FRAMING` 幾乎逐字命中 4.4 的框景規格：

```ts
"full-body standing front view of the character, facing the camera,
 both hands fully visible and relaxed naturally at the sides,
 entire body visible head to toe, clean pure white background,
 flat even studio lighting, sharp focus, no cast shadows, ..."
```

| 標準 | 對應實作 |
|---|---|
| 正視圖 | `full-body standing front view, facing the camera` |
| 雙手自然下垂 | `both hands fully visible and relaxed naturally at the sides` |
| 白色背景圖 | `clean pure white background` + `flat even studio lighting, no cast shadows` |
| 區分 2d / 3d | `stylePackId`（四個 pack 各有獨立 `assetPrefix`） |
| 主要角色都有面部特寫 | `faceImageMediaId`，鎖定主圖後自動生成，且為 shot 生圖的首選 identity anchor |
| 換髮型換服裝面部一致（部分） | `CHARACTER_IDENTITY_LOCK_OPEN/CLOSE` + `buildCharacterNegativePrompt` 的 `different face, different outfit` |

#### 缺口 4.4 —— 唯一一條被直接違反的硬要求

**「人物手上不攜帶武器」：本專案四個女角色全部攜帶。**

根因在 `text-handlers.ts:462`——`extract_assets` 的 `wardrobe` 欄位定義為「標誌服飾」，但 LLM 一律把武器一併塞入，然後直接串接成 `appearancePrompt`：

| 角色 | wardrobe 內容 |
|---|---|
| 鄭夏雨 | 红色轻型甲胄，**冷白长剑** |
| 李雪晴 | 露肩白金色法师长袍，**宝蓝色冰霜法杖** |
| 安吉拉 | 白色牧师袍，**十字法杖**，一对白色羽翼 |
| 艾琳 | 绿色劲装，**树枝长弓** |

而 `buildCharacterMainPrompt` 把 `basePrompt` 排在 `CHARACTER_FRONT_FRAMING` **之前**，於是同時下達兩條互相矛盾的指令：「畫住把冷白長劍」與「雙手自然放鬆垂在兩側」。模型必然選擇畫武器。

**傷害會往下游擴散**（這是本條優先級高的原因）：

1. 鎖定圖是**每一鏡的 identity reference**，武器隨角色進入每一格；
2. `appearancePrompt` 同時原文餵入 `locked_assets` 做凍結外貌文本，文字層再強調一次；
3. 本專案已有 `Prop` 資產與 `keyProps` 逐鏡匹配機制（`matchShotProps`），**武器本應只從這條路入畫**。現況是雙重表述，而燒死在角色身上的那一份必然勝出——逐鏡道具匹配被架空。

**修法**：`extract_assets` 明文規定 `wardrobe` 只允許寫穿戴在身上的物件（衣服／盔甲／飾物／髮飾），手持武器一律歸 `props`。不需 migration。

#### 其餘缺口

**4.1 — 零覆蓋，且踩中高風險組合。** 本專案五個角色全部 18 歲，配 `anime-01` 的 `expressive eyes`（`prefix` 與 `assetPrefix` 皆有）。四個 pack 的 `negativePrompt` 沒有 `childlike face`、`underage`、`oversized eyes`、`chibi`、`baby face`；`buildCharacterNegativePrompt`（`character-views.ts:71`）只追加身份類負面詞。

⚠️ 本條與第二章有交叉風險：**「18 歲 + anime 幼態臉 + 露出许多皮肤」是最容易觸發 provider content policy 的組合**，風險高於任何單一因素。

**4.2 — 部分達成。** views 層鎖定了 face／hairstyle／outfit／proportions，但**沒有提及膚色與色溫**。`buildCharacterViewPrompt` 的 `flat even studio lighting` 有間接幫助，但無明文鎖定。

**4.2 另有產品層缺口：「換服裝」本身不被支援。** 一個角色只有一份 `appearancePrompt`，沒有多套造型的概念。短劇角色必然換裝（副本裝／日常裝／禮服），此為功能缺口而非 bug，優先級低於前述各項。

**4.3 — 未覆蓋。** 沒有 `clipping`、`broken anatomy`、`see-through clothing` 一類負面詞。

---

## 四、需要的架構改動彙總

| 改動 | 對應標準 | 需要 migration |
|---|---|---|
| `extract_assets` 角色 `appearance` 禁令（比照場景 `description` 的嚴格程度 + 自我檢查） | 1.1 | 否 |
| `extract_assets` `wardrobe` 定義收緊（武器歸 props） | 4.4 | 否 |
| 四個 style pack 補負面詞與正面底線（顏值、光影、皮膚、敏感標誌、人體結構） | 1.2, 2.4, 2.5, 3.1, 3.4, 4.1, 4.3 | 否 |
| `prefix` 補皮膚質感詞（現只在 `assetPrefix`） | 3.4 | 否 |
| L2 核心特徵驗證（`out.prompt` 是否含齊凍結特徵，缺則重試一次） | 1.5 | 否 |
| L2 孤兒參考圖守衛（未被 `Image N` 引用的參考圖一律剝除 + 重新編號） | 1.5 | 否 |
| `storyboard_photography` 光影質量規則 + 自我檢查 | 3.1, 3.2 | 否 |
| `Scene.blocking.keyLight` 光線契約 | 3.3 | 否（Json 欄位） |
| `Project.deliveryProfile` | 第二章全章 | **是** |
| `Character` 外貌分層（`coreFeatures` / `optionalDetails` / `temperament` / `optimizationNote`） | 1.4, 1.5, 2.2, 2.4 | **是** |
| ~~L2 `422` 降級重試~~ —— **已取消**（2026-08-04 用戶決定：422 屬預期，過色本來就應該被 block） | ~~1.4~~ | — |
| L2 角色雷同守衛（鎖定時比對同 project 核心特徵重疊度） | 1.3, 4.5 | 否 |

### 4.1 關於「標準片段化」

交付標準是**橫切關注點**：同一條「不得醜化」需同時出現在 `extract_assets`、`character-views`、`image_prompt_shot` 與四個 style pack。逐檔手抄必然漂移。

**目標形狀**（一份定義，出兩個執行層）：

```
prompts/standards/character-appearance.txt   ← L1 片段
prompts/standards/lighting.txt
prompts/standards/female-audience.txt
```

catalog entry 增設 `includes: []`，由 `build-prompt.ts` 在渲染時展開；同一條標準另附機器可讀的斷言定義，供 L2 在 `callModel()` 之後執行；guard 腳本讀同一份清單，於 CI 驗證各 pipeline prompt 有無漏 include（鐵律 8）。

⚠️ 副作用：`prompts/canary/` 鎖的是 prompt 結構，加入 include 後 canary 必須覆蓋**展開後**的文本，否則修改共用片段會靜默繞過迴歸鎖。

**時序**：此項**不是第一步**。標準仍在收集中，過早抽象會把未定型的規格凍結成機制。待同一條標準確實需要在三個以上 prompt 出現時再抽取。

---

## 五、實作分片

每片必須貫通「貼文→出成品」的某一段（工作法：一 PR 一薄片），且各配 `scripts/guards/` 守衛（鐵律 8）。

### 第一片 · 止血（不動 schema）— ✅ 已完成

均為無爭議缺陷，不依賴任何待決事項，且當時每一鏡都在中招。

1. **`extract_assets` v15 → v16**（`prompts/pipeline/extract_assets.zh.txt`）
   - 新增「角色 appearance 判斷準則」：只准寫畫得出的外觀，職業／能力／經歷／性格一律禁止；附王楚實測反面例子與逐項自我檢查。
   - 新增「角色 wardrobe 判斷準則」：只准寫著戴在身上的東西，手持武器歸道具；界定長在身上的（羽翼、義肢、獸耳）屬 appearance；附四個角色的實測反面例子與逐件自我檢查。
   - canary `mustContain` 增 10 條、`tests/prompts.test.ts` 增一個回歸測試。
2. **四個 style pack `negativePrompt` 補齊六類缺陷詞**（光影缺陷／皮膚質感／幼態臉／醜化畸形／人體結構／敏感標誌），逐 pack 微調（`anime-01` 不加 pores 類詞，因其負面詞本身禁 `realistic skin texture`；大眼一項只禁 `oversized doll eyes`）。`prefix` 補皮膚質感詞——原本只有 `assetPrefix` 有，但觀眾看到的是鏡頭圖（`3d-01` 的 `prefix` 已有 `subsurface skin scattering`，不重複加）。
3. **L2 孤兒參考圖守衛**（`src/lib/prompts/shot-prompt-audit.ts`，11 個單元測試）
   - 核心不變式：**送出去的每一張參考圖，prompt 內都必須有 `Image N` 綁住**。純字串比對，語言無關。
   - 接線於 `media-handlers.ts`：審計不過 → 原樣重試一次（漏寫是隨機性失敗，不是 prompt 寫錯）→ 仍不過則剝除孤兒圖並**重新編號** `Image N`（不重新編號會由「指錯人」變成「指去空氣」，比不剝更差）。只在重試確實較佳時才採用重試結果。
   - `imagePrompt` 存審計後的版本，確保 DB 與實際送出的一致。
   - 角色名比對只在中文輸出啟用——英文輸出的角色名是羅馬拼音，逐個當漏寫會無限重試。
4. **面部特寫負面詞修正**：`buildCharacterFacePrompt` 分支原本只帶 `style.negativePrompt`，漏了身份類負面詞；面部特寫是每一鏡的首選 identity anchor，改為與 view 圖一致使用 `buildCharacterNegativePrompt`。
5. **`scripts/guards/delivery-standards-check.mjs`**（鐵律 8）：守 style pack 負面詞類別覆蓋 + `referenceMediaIds` 必須由 `audited.refs` 派生。

**未涵蓋（留待後續片）**：本片只保證「不會把身份圖亂綁到無名群眾」，**沒有**解決「模型漏寫角色」本身——重試失敗後該角色仍然缺席，只是不再造成複製人。核心特徵逐項驗證（標準 1.5 的完整形態）需待 §4 的外貌分層落地後才做得到，因為現行 `appearancePrompt` 是一整串自由文本，無法逐項比對。

### 第二片 · 光影

4. `storyboard_photography` 光影質量規則 + 自我檢查
5. `Scene.blocking.keyLight` 光線契約（`storyboard_plan` 鎖定、逐鏡繼承、豁免逐鏡過濾）

### 第三片 · 交付標準 profile（需 migration）

6. `Project.deliveryProfile` + 設定 UI
7. `extract_assets` 女頻分支（暴露度上限、得體服飾、氣質詞）
8. `Character` 外貌分層（核心／非核心／氣質）+ 優化說明（422 降級重試已取消）
9. 角色雷同守衛

### 第四片 · 標準片段化

10. 見 §4.1，視實際重複程度啟動

---

## 六、待決事項

1. **已鎖定資產的重審路徑**：本專案五個角色皆 `locked=true` 且鎖定圖、面部特寫均已生成。交付標準變更後需要「標示不符現行標準 → 解鎖重抽」的流程，不是改 prompt 就能生效。歸入第三片抑或獨立處理？
2. **`deliveryProfile` 的預設值**：新 project 預設 `none`（現行行為不變）抑或在建立時強制選擇？
3. **氣質層的來源**：由 `bio.personality` 自動推導，抑或於 `extract_assets` 增設獨立欄位？前者免改 schema，後者可控性較高。
4. **標準覆蓋範圍**：本文件僅涵蓋已收到的四章。投影片應尚有場景資產、鏡頭、成片等章節，收到後併入。

---

## 附錄 · 實證案例索引

| 案例 | 位置 | 說明 |
|---|---|---|
| 四個金髮紅甲複製人 | episode `019fb890-d2e5-7ca9-abb2-067d35f51907` 鏡 25 | `CROWD_DIRECTIVE` 被下游模型丟棄 + 鄭夏雨從 prompt 消失導致 Image 2 成為孤兒參考圖，兩者疊加 |
| 核心特徵蒸發 | 同上 | 王楚凍結外貌被縮寫為「黑髮黑瞳少年」，產出約二十五歲、現代連帽衫的男人 |
| 系統主動下單陰陽臉 | 同上 `photography` 欄位 | 高對比 + 單一強冷光源 + 高亮度 |
| 武器燒進角色鎖定圖 | 專案 `019fb890-d261-7484-addf-f5e8d6fb3eed` 四個女角色 | `wardrobe` 混入武器 → `appearancePrompt` → 鎖定圖 → 每鏡 identity reference |
