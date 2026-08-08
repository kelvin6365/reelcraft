# 分鏡 Prompt 研究筆記

**日期**：2026-08-03
**範圍**：從劇本到單幀生圖 prompt 這一段（`storyboard_plan` → `storyboard_photography` / `storyboard_acting` / `storyboard_detail` → `image_prompt_shot`）
**性質**：外部研究 + 對照本專案現況。結論分「已經做對」「有實證缺口」「待驗證假設」三類，不混為一談。

---

## 零、先講結論

本專案的分鏡層**設計品質高於市面上大部分同類工具**——四階段拆解、一鏡一凝固瞬間、空間契約、同框人數上限、凍結外貌文本，這些都是外部教程還沒普及、但研究支持的做法。

研究找到的真正缺口只有少數幾個，其中**一個是系統性的，並且已經用真實 A/B 證實**：`image_prompt_shot` 規定的「逗號分隔短語式」與所用生圖模型（Gemini 系 nano-banana）的官方建議相反，實測在 8 張對照中，敘述段落式在每一個可測維度都贏——景別、視角、景深這幾類**攝影規格指令**在逗號式之下幾乎完全失效。詳見 §1。

其餘缺口有一個共同模式：不是規則不夠多，而是**幾個關鍵欄位允許空值或中性預設**，而每個空值都會被生圖模型用它自己的先驗填滿。

---

## 一、最重要的發現：prompt 格式可能與模型家族不匹配

### 現況

`image_prompt_shot.zh.txt` 硬性規定：

> prompt 全條寫成 {output_language}、**逗號分隔短語式**

而本專案的生圖模型是 `fal::fal-ai/nano-banana`（Google Gemini 系）。

### 研究findings

Google 對 Nano Banana 的**官方**建議是相反的：

> "Describe the scene rather than simply listing keywords, as a **narrative, detailed paragraph often produces better, more coherent images than a simple, disjointed list of keywords**."

官方建議的六個成分是 Subject / Composition / Action / Location / Style / Editing Instructions，並且要「像攝影指導一樣導演這個鏡頭」，但寫成**連貫敘述**而非詞條堆疊。

### 為什麼會有這個分歧

「逗號分隔 + 品質詞堆疊」這套慣例來自 **Stable Diffusion / Midjourney 世代**——那批模型用 CLIP 文字編碼器，學術界研究的是「prompt modifiers」（subject terms、style modifiers、quality boosters、magic terms），關鍵字堆疊確實有效。

Nano Banana / Gemini 是**多模態原生**模型，文字理解走的是 LLM 路徑，長句語意與指代關係是它的強項。同一條 prompt 在兩個家族的最優形態不同。

值得注意：我查不到一份**直接對照**「敘述句 vs 詞條列」在兩個架構上的實證研究。所以這條屬於「官方建議 + 架構推理」，**不是實證結論**——應該做 A/B 才落實。

### A/B 實測結果（2026-08-03，已執行）

**設計**：episode `019fb890…51907` 鏡 7（過肩雙人）與鏡 13（俯視特寫），每鏡兩個變體 × 2 次，共 8 張。同一參考圖（同 mediaId、同順序）、同一 negative、同一 `9:16`、同一 `anime-01` style suffix、同一連續性條款、同一模型 `fal::fal-ai/nano-banana`。A = DB 內現行的逗號式 `imagePrompt` 原文；B = 同一組資訊的自然語言重述，不加料不減料。

**結果：B 在每一個可測維度都贏，8/8。**

| 指標（prompt 明文要求） | A 逗號式 | B 敘述式 |
|---|---|---|
| 鏡 7 · 過肩視角 | **0/2** — 出咗並排海報照與側面對峙 | **2/2** — 前景肩背 + 後景對象，教科書式過肩 |
| 鏡 7 · 淺景深 | **0/2** — 背景全清 | **2/2** — 背景明顯虛化 |
| 鏡 13 · 特寫景別 | **0/2** — 出咗中景／近景 | **2/2** |
| 鏡 13 · 俯視 | **0/2** — 平視 | **2/2** |
| 鏡 13 · 背景虛化 | **0/2** | **2/2** |
| 畫面不得有文字 | **1/2 違規** — 衣服印咗「Me?」 | 0/2 |
| 畫面左右位（空間契約） | 2/2 | 2/2 |

**失效模式高度一致**：A 版失敗的全部是**攝影規格類**指令（景別、視角、景深），角色身份與左右位反而沒問題。這正是機制預測的結果——逗號列沒有語法結構可以把屬性 scope 到某個對象，模型只能當成一袋權重相近的詞條，攝影詞被人物外貌詞淹沒。

同一機制在**輸入端**也看得到：鏡 7 的 A 版 prompt 把整段攝影屬性（「近景，過肩視角，淺淺景深，主體清晰為鄭夏雨，正面硬光…」）**原樣重複了兩次**，一次掛在鄭夏雨後面、一次掛在王楚後面——因為逗號式沒辦法表達「這段是全鏡共用的」。敘述式一句「鏡頭越過他的肩膀望向鄭夏雨」就同時交代了機位、兩人關係與景深主體。

另外 A 版出現「雙手**可能**插在腰間或自然垂下」——模板明文禁止含糊詞，逗號式讓這種未決狀態很容易混進去。

⚠️ **這個結論的限度要講清楚**：n=8、單一模型、單一 style pack、單一場景、兩個鏡頭，而且 B 版由人手撰寫。最大的殘留混淆是**作者品質**——B 可能只是「寫得比較好」而非「敘述形態比較好」。已用「同一組資訊、不加料不減料」控制，但無法完全排除。不過失效模式與機制預測吻合得很緊（失敗全部集中在需要 scope 的攝影規格），支持形態解釋。

### 建議

方向已經足夠明確，但改的是模板核心規則，建議分兩步：

1. **先改格式規則、跑一次全集重生**，人手比對整集（而非兩鏡）——這才是真正的驗收。
2. 保留逗號式的三個例外不變：`Image N`、`style_suffix`、`negativePrompt`（都是 token 層面的東西，不是句子）。

改動點集中在 `image_prompt_shot.zh.txt` 的「生圖 prompt 撰寫規則」一節：把「逗號分隔短語式」改成「連貫敘述段落」，並把現行的「次序寫死」由詞條順序改成敘述順序（鏡頭與機位 → 主體與動作 → 光影色調 → 環境 → 連續性條款 → style_suffix）。字數上限維持不變（DetailMaster 的長度退化結論不受形態影響）。

---

## 二、參考圖：要講明「這張圖管什麼」，不只是編號

### 研究findings

Google 官方：

> "When using uploaded images, **clearly define the role of each**. (e.g., 'Use Image A for the character's pose, Image B for the art style')"

### 現況對照

本專案的 `reference_legend` **變數**確實有標角色：

```
Image 1: 大地亚龙巢穴·日（場景主視角） — location reference
Image 2: 郑夏雨（面部特寫） — identity reference
```

但這只存在於**送給文字模型的輸入**。文字模型產出的、真正送到生圖模型的 prompt，只寫「王楚（Image 3 中的黑髮黑瞳少年）」——**沒有說明 Image 3 的作用範圍**。

生圖模型收到的是「這裡有三張圖」+「Image 3 是那個黑髮少年」，但沒有「Image 3 只管臉和衣服，不管姿勢構圖布光」。這個資訊目前靠通用的連續性條款兜底（「參考圖僅作身份參照：只沿用臉部、髮型與服裝…」），是**全域一句**而非**逐圖綁定**。

### 建議

低風險、可以即做：在連續性條款之外，要求逐張參考圖寫明作用域，例如「Image 1 提供場景的佈景與色調基調；Image 2、Image 3 只提供人物身份（臉、髮、服裝）」。

這與剛落地的孤兒參考圖守衛是同一條線的延伸——守衛保證「每張圖都有 `Image N` 綁住」，這一步保證「綁住之後說清楚綁的是什麼」。

---

## 三、光線方向要跨鏡鎖定 —— 外部獨立驗證

[交付標準設計](2026-08-03-delivery-standards-design.md) §3.3 提出的 `Scene.blocking.keyLight` 契約，在外部資料中得到獨立驗證：

> "Describe lighting consistently across shots to prevent spatial disorientation: **'Key light from camera-left, 3200k color temperature'** ensures shadows remain consistent between reverse shots."

值得注意的是，外部把它歸類為 **180 度軸線問題的一部分**，而不是攝影美學問題——光源方向不一致造成的是**空間迷失**，與跳軸同一類傷害。這強化了「keyLight 應該和 `cameraAxis` 一樣存在於場景契約、一樣不做逐鏡過濾」這個設計。

建議的欄位形態（比原提案更具體，採用外部的參數化寫法）：

```
keyLight: { direction: "camera-left", quality: "硬光", temperature: "3200K", motivation: "陰雲透光" }
```

`temperature` 用色溫數值而非「冷／暖」——外部範例用 3200k，數值對生圖模型是更強的錨點，而且跨鏡比對是精確的。

---

## 四、視線方向：現行允許「无。」，這是浪費掉的一個強錨點

### 研究findings

> 避免含糊語言。不要寫 "looking at the other person"，要寫 **"Character gaze directed at off-screen position, 15 degrees camera-left"** 或 "Profile shot, character looking directly camera-right at eye level."

視線方向是 shot-reverse-shot 空間邏輯的核心承載——它和角色的畫面左右位一起，決定觀眾腦中的空間模型。

### 現況對照

`storyboard_acting` 有 `eyeline` 欄位，但**沒有規定必須是具體方向**。實測鏡 25：

```json
"eyeline": "无。",
"expression": "无。"
```

三個表演欄位有兩個是「无。」，然後這兩個「无。」還會被 `image_prompt_shot` 讀到。空的 eyeline 等於把空間錨點交還給模型自由發揮——而本專案自己的研究結論正是「**留白等於邀請模型照抄參考圖**」。

### 建議

`storyboard_acting` 加硬性規則：`eyeline` 必填且必須是**畫面相對方向**（畫面左／畫面右／望向鏡頭／望向畫面外左前方），不准寫「无」「不適用」；獨處鏡頭也要寫（望向手中物件、望向窗外、垂眼）。`expression` 同理——本專案已經有「唔准淨係『開心／傷心』」的規則，但沒有禁止「无」。

這條屬 L1+L2：能程式化判定（欄位值在不在允許集合內），所以應該配確定性檢查。

---

## 五、豎屏 9:16 的景別分佈，現行是中性的

### 研究findings

豎屏短劇的景別分佈與橫屏電影**不同**，不是風格偏好而是畫幅決定的：

> 在 9:16 的豎屏畫布中，短劇多採用特寫、中近景畫面，**人物通常佔據畫面 70% 以上的面積**，使得畫面效果與人物肖像畫極為相似。

> 豎屏影像與觀眾的距離更為貼近，人物佔據畫面更大比例，能夠放大情緒體驗與情感衝突。

原因是幾何的：9:16 的水平視野只有 16:9 的約三分之一，同一個「全景」在豎屏裡人物只剩一小條，環境資訊反而塞不下。

### 現況對照

`storyboard_detail.zh.txt` 的景別規則是**中性**的：

> 對話重表情用近景或特寫，交代環境用全景或遠景。

沒有任何豎屏偏置，而 `project.videoRatio` 預設就是 `9:16`。實測鏡 25 用「中景」，畫面裡要放兩個主角 + 一群隊員 + 巢穴 + 天空——在 9:16 裡這個景別根本裝不下，結果就是人物縮到很小、細節全丟。

### 建議

`storyboard_detail` 的景別庫按 `videoRatio` 分支：9:16 時，預設重心下移一級（原本會選全景的選中景、原本中景的選近景），遠景／全景只保留給真正的建立鏡頭，並明說「豎屏構圖人物應佔畫面 70% 以上」。

這條的價值可能被低估——它同時改善**身份保真**：人臉在畫面中佔比越大，像素密度越高，而本專案已經知道「身份訊號在面部像素密度」（ISO/IEC 39794-5 最低 IED 90px）。景別選錯 = 臉太小 = 身份鎖不住。**這條和第一條的 A/B 可能同樣重要，而且不需要 A/B 就知道方向是對的。**

---

## 六、文字分鏡有天花板 —— DramaDirector 的結論

arXiv 2606.24107（DramaDirector，短劇生成）直指本專案空間契約的根本限制：

> "**text storyboards underspecify cinematographic geometry**"（文字分鏡無法充分指定攝影幾何）

他們的解法不是把文字寫得更詳細，而是**改變問題性質**：從真實短劇素材庫檢索 depth map 與 pose skeleton 做視覺先驗，「turns cinematographic grounding from a text-prompting problem into a **retrieval-and-reward problem**」。消融實驗顯示 **depth 是最主要的檢索線索，拿掉它檢索幾乎崩潰**。

架構上他們也把分鏡拆成兩層，與本專案四階段的切法高度吻合：

| DramaDirector | 本專案對應 |
|---|---|
| static visual conditions（機位、場景、主體狀態） | `detail` + `photography` |
| dynamic narrative conditions（動作、對白、情緒） | `plan` + `acting` |

### 對本專案的意義

**不是叫你去做檢索系統**——那是研究級投入。有意義的是期望管理與優先級：

1. 空間契約（文字）有天花板，不斷加細文字規則的邊際回報會遞減。跳軸這類幾何問題，文字擋不乾淨是**正常的**，不是規則寫得不夠好。
2. 今天可用的幾何錨點只有一個：**場景鎖定圖**。它是本專案唯一在提供空間先驗的東西，其價值可能被低估了——外部同樣建議 "Master Shot Anchoring"：先生最寬的建立鏡頭，用它約束後續所有近景的空間邏輯。
3. 分鏡欄位的兩層切分（靜態視覺 / 動態敘事）已經做對了，不用重構。

---

## 七、video_prompt 與 Seedance 的文件格式不一致

本專案的視頻模型是 `atlascloud::bytedance/seedance-2.0-mini`。Seedance 的實操資料建議的鏡頭 prompt schema 是**管道分隔的欄位式**：

```
时长 + 景别 + 运镜 + 画面内容 + 光影 + 音效
镜头1｜0-3s｜远景｜缓慢推镜｜雨夜城市天台，男主独自站立｜冷蓝色霓虹侧光｜低沉环境雨声
```

運鏡要參數化到「運鏡類型 + 移動速度 + 鏡頭角度 + 焦點控制」，例如「緩慢向前推鏡，速度 0.3 倍慢推，45 度俯角，焦點鎖定人物面部」。參考素材用 `@序號` 綁定。

而本專案的 `detail.video_prompt` 是**英文散文**：

```
the man raises his hand, an invisible force sweeps through, ..., static camera,
single continuous shot, natural motion, no morphing
```

⚠️ 這條可信度低於前面幾條：來源是第三方實操文章而非位元組官方文檔，而且本專案的散文式 video_prompt 是有意設計的（`storyboard_detail` 明文要求「一句到兩句連貫散文」）。列出來是為了記錄「模型有自己的文件格式」這個事實，**建議先查 Seedance 官方文檔確認**，再決定要不要改。`prompts/models/` 目錄本來就是放這類 per-model prompt 規範的地方。

另外一個要小心的分歧：該資料建議「超過 6 鏡就分 3-4 鏡一組，每組繼承上一組尾幀做參考」。這與本專案已知的結論衝突——鏈式（上一鏡餵下一鏡）是身份漂移的已知反模式，論文推薦的是每鏡回錨原始角色圖的 star topology。兩者其實講的是不同層次（單次生成內的多鏡連貫 vs 跨鏡身份保持），**不要混用**。

---

## 八、驗證了「已經做對」的部分

研究過程中確認以下設計有外部支持，不需要改動：

| 本專案做法 | 外部支持 |
|---|---|
| 凍結外貌文本、handler 組裝、不准 LLM 每鏡重寫 | 「Write one locked master description for each character and paste the **exact same text** into every prompt. Do not rephrase or paraphrase.」 |
| 一鏡一凝固瞬間、每 15 字一鏡的密度啟發式 | 「most scenes need 3 to 8 shots」；visual beat = 需要自己一張圖的時刻，不是每句對白一鏡 |
| 四階段分鏡欄位（plan/photography/acting/detail） | 行業分鏡表標準欄位：鏡號、景別、鏡頭運動、畫面內容、台詞、音樂音響 — 全部覆蓋 |
| `cameraAxis` 一場一鎖、不逐鏡過濾 | 180 度軸線是跨鏡連戲唯一依據；AI 生成要「manually enforce」並明寫 camera-left/right |
| 禁止「dramatic / cinematic / moody」這類空泛詞 | 「every AI training image was captioned the same way」→ 產出通用結果；要換成具體視覺指令 |
| 每角色控 8–12 個特徵、不無限加長 | DetailMaster：所有模型隨 prompt 加長而退化，attribute binding 準確率僅約 50% |
| 場景鎖定圖做空間錨 | "Master Shot Anchoring" — 先生最寬的建立鏡頭做環境常量 |
| negative prompt 明確排除群眾／多餘道具 | 「If you want a clean two-person dialogue scene, tell the AI to exclude background crowds」 |

---

## 九、建議優先級

| # | 項目 | 依據強度 | 成本 | 建議 |
|---|---|---|---|---|
| 1 | **9:16 景別偏置**（§5） | 高（幾何必然 + 身份像素密度） | 低（改一個 prompt） | **即做** |
| 2 | **eyeline / expression 禁「无」**（§4） | 高（本專案自己的「留白＝邀請照抄」結論） | 低 + L2 檢查 | **即做** |
| 3 | **參考圖作用域寫入 prompt**（§2） | 高（官方明文） | 低 | **即做** |
| 4 | `keyLight` 場景契約（§3） | 高（外部獨立驗證） | 中（Json 欄位 + prompt） | 併入交付標準第二片 |
| 5 | **prompt 改敘述段落式**（§1） | **高（已做 A/B，8/8 勝）** | 中（模板核心規則 + 全集重生驗收） | **做**，但要全集驗收 |
| 6 | Seedance video_prompt 格式 | 低（第三方來源） | 低 | 先查官方文檔 |

前三項都是低成本、方向明確、不需要 A/B 的改動，而且三項都指向同一個效果：**把留白補上**。本專案分鏡層的問題已經不是「規則不夠多」，而是**幾個關鍵欄位允許空值或中性預設**，而每一個空值都會被生圖模型用它的先驗填滿。

---

## 來源

- [Nano Banana Pro image generation in Gemini: Prompt tips — Google 官方](https://blog.google/products-and-platforms/products/gemini/prompting-tips-nano-banana-pro/)
- [Nano Banana Prompt Guide — Leonardo.Ai](https://leonardo.ai/news/nano-banana-prompt-guide)
- [DramaDirector: Geometry-Guided Short Drama Generation — arXiv 2606.24107](https://arxiv.org/html/2606.24107v2)
- [One Sentence, One Drama: Personalized Short-Form Drama Generation via Multi-Agent Systems — arXiv 2605.22144](https://arxiv.org/html/2605.22144)
- [Director's Guide: Shot-Reverse-Shot Spatial Logic — Hailuo AI](https://hailuoai.video/pages/knowledge/director-guide-shot-reverse-shot-spatial-logic)
- [How to write Storyboard Prompts: A Complete Guide — DrawStory](https://www.drawstory.ai/blog/how-to-write-storyboard-prompts)
- [How to Use Storyboards and Character Sheets to Get Better AI Video Results — MindStudio](https://www.mindstudio.ai/blog/storyboards-character-sheets-ai-video-generation)
- [影視分鏡 AI 生成：Seedance 2.0 導演級視頻操控完整實操技巧 — SegmentFault](https://segmentfault.com/a/1190000047876528)
- [豎屏短劇美學：如何用「9:16 美學」日賺百萬流量 — 澎湃新聞](https://www.thepaper.cn/newsDetail_forward_30425589)
- [豎屏影像：一種屏幕定制化的美學形態 — 光明網](https://m.gmw.cn/2024-02/28/content_37171425.htm)
- [視頻製作基礎：劇本與分鏡頭腳本解析 — CSDN](https://blog.csdn.net/qq_62678419/article/details/131840028)
- [How to Turn a Script into an AI Storyboard or Shot List — Higgsfield](https://geo.higgsfield.ai/blog/recommended/how-to-turn-a-script-into-an-ai-storyboard-or-shot-list-dc4e54)
- [180-degree rule — Wikipedia](https://en.wikipedia.org/wiki/180-degree_rule)
- [DetailMaster / 長 prompt 退化與 attribute binding 基準 — arXiv](https://arxiv.org/pdf/2505.16915)（本專案 2026-08-01 角色一致性研究已引用）
