# 競品用戶回饋研究 — Toonflow / 火豹短劇 / waoowaoo / LibTV

> 日期：2026-07-22 · 方法：4 個並行 agent，各跑 GitHub issues/PR → README/docs/commits → 中英文社群
> 用途：驗證 `2026-07-22-episode-workflow-uiux-review.md` 的 18 條問題，哪幾條是真痛點、哪幾條是我們自己想像
> 授權：全部引用是 GitHub issue 公開留言、README 散文、第三方評測文。**沒有複製任何 source code 或 prompt 原文。**

## 0. 樣本概況

| 項目 | Star | Issues | 狀態 | 社群 |
|---|---|---|---|---|
| **Toonflow** (`HBAI-Ltd/Toonflow-app`) | 11,937 | 162（161 closed / 1 open） | 活躍，v1.1.8 (2026-06-08) | 簡中為主；Discussions 3 帖形同虛設；真支援在微信群 |
| **火豹短劇** (`chatfire-AI/huobao-drama`) | 13,635 | 67（18 open / 49 closed）+ 33 PR | **2026-04-07 後只改 README** | 簡中壓倒性；Discussions 關閉；真支援在微信群（已滿員） |
| **waoowaoo** (`waooAI/waoowaoo`) | 13,320 | 162（134 open / 28 closed） | **2026-04-03 後停更 3.5 個月** | 簡中 85%；Discussions 關閉；**PR 完全禁用**；微信群長期爆滿 |
| **LibTV** (`liblib.tv`) | — 商業 SaaS | — | 高速迭代（兩個月 36 功能） | 上海哩布哩布；2026-03-18 上線；非短劇垂直工具，是通用 AI 視頻平台 |

### ⚠️ 三個取樣偏差，讀這份報告前必須知

1. **真支援渠道全部在微信群，不在 GitHub。** 三個 OSS 項目都是。GitHub issue 是**溢出渠道**，實際痛苦量被嚴重低估。（Toonflow ≥6 條 issue 是維護者叫人「加群搵袋子遠程睇下」；火豹 #86 標題直接就是「群满员了，还想进群」）
2. **火豹 54% issue 是 provider 配置問題** → 大部分用戶連第一次成功生成都未試過。真正的工作流反饋只有約 15 條。**「冇人投訴 X」不等於 X 沒有問題，可能是他們根本走不到那一步。**
3. **SEO 稿同真實反饋完全相反。** 所有 aggregator 稿寫火豹「角色一致性出色、解決臉崩」，但零個真實用戶這樣講 —— 反而是 top complaint，維護者自己都承認「一致性冇辦法保持」。**做競品定位時不可信那批稿。**

LibTV 那份額外要打折：wangdu.site 是唯一一個明確獨立、被產品燒到的用戶；騰訊新聞/搜狐那批讀起來似廠商投放 PR。

---

## 1. 跨項目共同模式（四個項目都符合）

### 🔥 模式 A：失敗即燒錢 —— issue tracker 裡面情緒最強的一類

沒有一個項目做到「失敗唔使用戶找數」。

| 項目 | 原文 |
|---|---|
| waoowaoo | 「生成分镜细节时，超时时间为30分钟，**一旦超时所有已经生成的内容会丢失**」（[#61](https://github.com/waooAI/waoowaoo/issues/61)，三個「我也遇到了」） |
| waoowaoo | 「抛错误后会**很烧token，结果还是失败的没有提示**」（[#138](https://github.com/waooAI/waoowaoo/issues/138)） |
| waoowaoo | 「会**重复生成已经完成的**，状态会变进行中然后重复执行，及其消耗 token」＋「关闭网页后重新打开，会重新开始分镜规划1/2」（[#100](https://github.com/waooAI/waoowaoo/issues/100)） |
| 火豹 | 標題：「**白花钱 不好用 视频报错 实际是背后处理 没有Poll Token就丢了 扔钱**」— provider 回 202 PROCESSING 被當 error，task_id 丟失，錢照扣（[#88](https://github.com/chatfire-AI/huobao-drama/issues/88)） |
| Toonflow | 「api平台**没有退款选项**」→ 官方：「第三方請聯繫對應的中轉平台客服」（[#118](https://github.com/HBAI-Ltd/Toonflow-app/issues/118)） |
| LibTV | 「烧了170万token，最后失败了」「Token 消耗：1,748,280 tokens」（wangdu.site） |

實際金額：火豹「**一坤分鐘嘅短劇花咗 50 蚊**」→ 群嘲「貴成咁係要上天嗎？」；waoowaoo「白跑咗 50 幾蚊嘅火山」；知乎 NAS 部署文估「一集約 100 蚊」（弱來源）。

**→ 對我們**：鐵律 6（retryable 先入 BullMQ）同 AiCallLog 已經是對的地基。要補的是**用戶可見層**：失敗時講清楚「已燒咗幾多、有冇計費、可唔可以只重跑失敗嗰部分」。

### 🔥 模式 B：重跑粒度太粗 + 覆蓋式重生毀滅數據

| 項目 | 原文 |
|---|---|
| Toonflow | 官方認架構限制：「**目前僅支持全量新增，無法做到單個修改**，該問題會在重構版本修復」（[#191](https://github.com/HBAI-Ltd/Toonflow-app/issues/191)） |
| Toonflow | 用戶標「嚴重」：「導演計劃和分鏡表在修復嘅時候**經常直接覆蓋 導致丟失**…建議使用標準結構化嘅數據來存儲，**非重做情況下定向修改**」（[#85](https://github.com/HBAI-Ltd/Toonflow-app/issues/85)）。協作者回：「目前只做了替換，單行修補同塊修復**仲喺排期**」 |
| Toonflow | 「一刷新工作區，**所有嘅分鏡面板數據全部消失**」（[#199](https://github.com/HBAI-Ltd/Toonflow-app/issues/199)）／手動編輯 switch tab 後丟失（[#149](https://github.com/HBAI-Ltd/Toonflow-app/issues/149)） |
| waoowaoo | 「攝影規則報錯導致整個任務失敗，重跑仲要耗費時間同 token…**如果能把任務拆解一下就更好了**」（[#136](https://github.com/waooAI/waoowaoo/issues/136)） |
| waoowaoo | 「做到資產分析嗰步，**唔小心撳咗 Esc，整個項目直接丟失**」（[#165](https://github.com/waooAI/waoowaoo/issues/165)） |
| LibTV | 反面教材：per-shot 重生是他們最被稱讚的賣點 ——「可以對單一片段進行修改，**省去開盲盒嘅資源浪費**」 |

**→ 對我們**：我們分鏡站是四階段導演組（規劃→攝影→表演→細節）。如果一階段失敗要成站重跑，就是 waoowaoo #136 同一個坑。**要查 `STORYBOARD_RUN` 有沒有逐階段／逐鏡持久化。**

### 🔥 模式 C：成片站沒有閉環 —— 前七站白做

| 項目 | 原文 |
|---|---|
| 火豹 | 「**有一個視頻生成失敗，後續嘅就無法再合成視頻同導出視頻**」— 一個 clip 死，整集 merge 死（[#84](https://github.com/chatfire-AI/huobao-drama/issues/84)，無人回） |
| waoowaoo | 「感覺**呢啲冇連埋一齊仲係唔太得**」；「Users currently have to use external tools to merge the videos manually」；輸出沒有音軌（[#124](https://github.com/waooAI/waoowaoo/issues/124)/[#149](https://github.com/waooAI/waoowaoo/issues/149)） |
| Toonflow | 「製作嘅視頻冇聲音，希望能支持」＋「**最重要嘅就係能支持所有視頻片段一鍵拼接**」（[#28](https://github.com/HBAI-Ltd/Toonflow-app/issues/28)，同一句還有讚「非常棒嘅項目」） |
| LibTV | 2026-03 實測工作流仍然是「下載視頻片段，導入**剪映**拼接」 |

**→ 對我們**：**四個項目沒有一個做妥第八站。** 這個是最清晰的差異化位。我們 ExportPanel 已經有 compose + 下載 MP4 —— 但要驗證**部分失敗時能不能跳過失敗鏡頭照合成**（火豹 #84 這個坑）。

### 🔥 模式 D：沒有手動逃生門 —— AI 生成不出就卡死

| 項目 | 原文 |
|---|---|
| waoowaoo | 「**不停咁抽卡太浪費時間同銀子**」（[#181](https://github.com/waooAI/waoowaoo/issues/181)） |
| waoowaoo | 「**描述半天都不如我畀一張參考圖來得準確**…咁樣其實我覺得更慳 token，因為來回改嘅次數變少咗」（[#178](https://github.com/waooAI/waoowaoo/issues/178)）← 用戶自己講明這個是慳錢手段 |
| 火豹 | 「生成嘅分鏡或人物圖片唔滿意，**可唔可以上傳本地圖片**？」（[#90](https://github.com/chatfire-AI/huobao-drama/issues/90)，無人回，PR #94 未合） |
| Toonflow | 「有啲資產可能需要從別嘅地方生成、或者人工 PS 精修，**冇辦法手動上傳**」（[#83](https://github.com/HBAI-Ltd/Toonflow-app/issues/83)／[#136](https://github.com/HBAI-Ltd/Toonflow-app/issues/136)） |

**→ 對我們**：我們 MediaObject 抽象已經有，**暴露一個上傳入口成本極低，但是四個項目共同的未解需求。** 高 ROI。

### 🔥 模式 E：錯誤訊息無用 + 靠遠程支援

- Toonflow [#32](https://github.com/HBAI-Ltd/Toonflow-app/issues/32)：「錯誤提示過於簡略如『錯誤:數據解析/腳本生成異常』…**無法確定係 API 唔通、定係模型指令跟隨唔行、再或者 JSON 解析唔正確**，建議提供日誌顯示選項卡」
- waoowaoo [#4](https://github.com/waooAI/waoowaoo/issues/4)（社群自發審計）：同一個「分析模型未配置」錯誤有**六種不同寫法**，指向**三個不同設定入口**，顯示成「準備失敗: analysisModel is not configured」—— 中文前綴 + 英文技術 key + 沒有連結指向可以改的地方
- waoowaoo [#152](https://github.com/waooAI/waoowaoo/issues/152)：「提示叫我配置『分析模型』，可我已經配置咗喎？」
- 火豹 [#18](https://github.com/chatfire-AI/huobao-drama/issues/18)：用戶貼成頁 log 求救，真正原因是 log 裡面一句 `{"message":"额度不足"}`，旁人回「額度不足，唔係提示咗咩」—— 即是 UI 完全沒有 surface
- 後果：Toonflow 維護者 debug 不到，只能不斷叫人「請聯繫群裡嘅袋子，畀你遠程睇下」→ 用戶：「**拉群小助手唔理我。。。。有其它加群方式嗎？**」

**→ 對我們**：commit bd66e4a「錯誤引導」方向正確，`humanizeTaskError` 已有 terminal/retryable + action href。要確保覆蓋 provider 原始錯誤映射。

---

## 2. 對我們八站設計最直接的三個驗證

### ✅ 驗證 1：「引導式逐步」方向對 —— 一個 13.6k star 競品主動轉這個方向

火豹 v2.0（2026-03-28）的 commit 訊息：
- `feat: guided wizard for script panel — one step at a time`
- `feat: redesign storyboard panel — card list + side editor`
- `feat: complete UI redesign`

即是：**累積一年用戶反饋之後，他們主動由自由介面轉向「一次一步」的引導 wizard。** 正正是 UIUX 審查 #1 提議的方向。

LibTV 從反方向印證同一件事 —— 他們押注無限畫布 + 節點圖，結果：
- 「無限畫布同節點邏輯有一定學習成本」「**對無工具使用經驗嘅新手唔友好**」（aixq.cc，★★★☆☆）
- 「素材太多，要用嘅時候壓根搵唔到」「生成出嚟嘅版本太多對唔上」
- 「幾個人同時操作，**唔打組就係災難**」
- 然後 2026-05 的 release **買回結構**：團隊素材庫、分鏡組 Ctrl+G、權限分級、積分池

> **推論**：LibTV 買了彈性，用「素材搵唔到 / 版本對唔上 / 打組災難 / 學習成本」付出代價，再花一個 release 買回結構。**ReelCraft 由 LibTV 撤退到的位置起步。** 但風險是鏡像的 —— 引導式管線會趕走 power user，所以 LibTV 證明是承重的逃生門（per-shot 重生、就地改 prompt、勾選式批量表、slash 指令層）才是要優先做的事。

### ⚠️ 驗證 2：「card list + side editor」這個 pattern 有陷阱

火豹同 waoowaoo 都用左列表/右詳情，兩邊都出事：
- waoowaoo [#43](https://github.com/waooAI/waoowaoo/issues/43)：「點擊左側切換鏡頭時，右側工具欄裡嘅數據（提示詞、圖片）有時錯亂」
- 火豹 [#43](https://github.com/chatfire-AI/huobao-drama/issues/43)：「切換分鏡會把之前嘅提示詞帶出嚟，**一唔小心就撳咗生成圖片**」← **狀態殘留直接燒錢**

**→ 令我對 side-editor 有保留。** 審查 #7 提議的「一鏡一行」反而安全（沒有共用的 detail pane 就沒有 stale state）。但要留意 LibTV 的做法值得抄：**分鏡做成 spreadsheet 式表格，第一列 checkbox，可隱藏欄位，勾完「單條或批量轉圖片」** —— 這個是批量重跑最順的 UI。

### ✅ 驗證 3：「進階模式 Prompt 編輯」（commit 6f3cf9a）打中真需求

- 火豹 [#93](https://github.com/chatfire-AI/huobao-drama/issues/93)，用戶自己標「**嚴重問題**」：「除咗劇本分鏡以外**其它提示詞都唔可以更改**。角色、場景、道具、配音、視頻等**只有生產按鍵，冇提示詞更改嘅地方**」
- waoowaoo [#182](https://github.com/waooAI/waoowaoo/issues/182)：「我哋實際上係有一套提示詞腳本…希望能有功能可以直接通過呢啲鏡頭腳本生成分鏡」← 專業用戶自帶 prompt 資產
- LibTV 163.com 實測：深夜辦公室鏡頭「憑空多出咗一塊屏幕」，要人手改 prompt

**注意**：火豹 #93 講明要覆蓋**每一站**（角色/場景/道具/配音/視頻），不只劇本分鏡。我們 `StationPromptSheet` 目前 promptIds 覆蓋：assets/script/storyboard/voice —— **images 同 videos 兩站沒有**（`panels.tsx:743,765` 沒有傳 promptIds）。

---

## 3. 印證我們鐵律的實戰案例（別人踩過的雷）

| 鐵律 | 別人的翻車方式 |
|---|---|
| **4. DB 只存 storage key** | 火豹 [#58](https://github.com/chatfire-AI/huobao-drama/issues/58)：「上星期生成嘅圖片、視頻打唔開咗…簽名 URL 有效期 24 小時（X-Tos-Expires=86400）」→ 用戶自己得出結論「最好嘅解決方法就係用自己嘅存儲」。waoowaoo [#17](https://github.com/waooAI/waoowaoo/issues/17)：「生成新候選圖後撳『確認選擇』**有好大機率失敗**」— 傳簽名 URL 而不是 key |
| **6. 重試由 app 層話事** | 火豹 [#88](https://github.com/chatfire-AI/huobao-drama/issues/88)：provider 回 **202 PROCESSING 被當成 error**，task_id 丟失，錢燒了拿不回結果 |
| **3. `provider::modelId` 複合 key，禁預設降級** | LibTV **靜默降級**：「當前模型需要 VIP 權限，**正在切換到 Kling 2.1 模型**」— 用戶不知道自己出了什麼事。火豹 [#12](https://github.com/chatfire-AI/huobao-drama/issues/12)：localStorage 快取模型優先級過高，換了模型重開章節仍讀取舊快取。waoowaoo [#168](https://github.com/waooAI/waoowaoo/issues/168)：「設定裡已經揀咗 deepseek，但寫劇本仍然報錯 gpt-4.1 is not enabled」 |
| **1. 所有表帶 userId** | waoowaoo [#139](https://github.com/waooAI/waoowaoo/issues/139)：「**任何人都能註冊，註冊入嚟就係管理員權限**，網址被知道就會被濫用 token」；[#200](https://github.com/waooAI/waoowaoo/issues/200)/[#201](https://github.com/waooAI/waoowaoo/issues/201)：私有媒體沒有 ownership check |
| **5. API 永不回傳明文金鑰** | Toonflow [#178](https://github.com/HBAI-Ltd/Toonflow-app/issues/178)：企業用戶要求「模型 API Key 通常會由管理員統一配置，而唔係讓每個成員自己填」；waoowaoo [#67](https://github.com/waooAI/waoowaoo/issues/67)：api key 洩露 |
| **2. 統一 `callModel()` 入口 + AiCallLog** | LibTV 團隊版最大投訴：「對團隊成員積分管理唔細緻，導致團隊算力成本高得離譜，但**具體邊個花咗幾多，又冇系統統計**」→ 我們 AiCallLog 已有 audit，要曝光成 per-user/per-episode 報表 |

**我們現有架構已經擋住了上面大部分。** 但這些不是理論潔癖 —— 每一條都有真人在 issue 裡慘叫。

---

## 4. 研究揭示、我 UIUX 審查**沒有覆蓋**的新缺口

| 編號 | 缺口 | 來源 | 要查／要做 |
|---|---|---|---|
| **N1** | **AI 自審循環沒有收斂條件** | Toonflow [#218](https://github.com/HBAI-Ltd/Toonflow-app/issues/218)：「觸發審核→修復→再審核→再修復，能持續 **7-8 輪**…每次修復後再審核都係**全局掃描**，總會掃出新嘢」 | 我們剛剛做了「🩺 劇本體檢」，同一個設計。查 `script-review` 有沒有輪數上限／只掃改動過的場 |
| **N2** | **單鏡失敗阻塞整集合成** | 火豹 [#84](https://github.com/chatfire-AI/huobao-drama/issues/84) | 查 `compose` 有沒有 skip-failed / 佔位路徑，逐 clip 顯示狀態 |
| **N3** | **重跑要 additive + versioned，不要 in-place 覆蓋** | Toonflow [#85](https://github.com/HBAI-Ltd/Toonflow-app/issues/85)（用戶標嚴重） | 我們「重新生成分鏡」是清走所有鏡頭。至少要保留舊版本可回溯 |
| **N4** | **模型能力矩陣要是一等公民** | 火豹 [#20](https://github.com/chatfire-AI/huobao-drama/issues/20) 維護者：「**有啲模型冇參考圖嘅能力**，所以生成嘅幀圖片全憑提示詞，一致性冇辦法保持」 | 不支援參考圖的模型應該在**選擇時就 disable**，不是生成完才告訴你 |
| **N5** | **三層模型解析要顯示「最終生效值」** | waoowaoo [#168](https://github.com/waooAI/waoowaoo/issues/168) | UI 不可以只顯示「你揀咗咩」，要顯示 server 解析後實際用哪個。我們 ModelChip 已做了一半（只在 images/videos 站） |
| **N6** | **空 prompt 不應該可以入 queue** | Toonflow [#231](https://github.com/HBAI-Ltd/Toonflow-app/issues/231)：「點開任意一個分鏡圖，裡面嘅提示詞係空嘅…佢能夠補齊，但會**重新生成一組新嘅卡片**，舊嘅仲係空 prompt 要手動刪」 | 生成前 validate（呼應鐵律 7 變數嚴格驗證） |
| **N7** | **跳站**：視頻模型自帶音頻時應可 bypass 配音站 | 火豹 [#92](https://github.com/chatfire-AI/huobao-drama/issues/92) | 八站不應該硬性全部執行 |
| **N8** | **分鏡表要有真正表格語意**（插入/重排/自動編號/merge 鏡頭） | Toonflow [#119](https://github.com/HBAI-Ltd/Toonflow-app/issues/119)：「插入一行之後，下面行嘅編號都要自己手動改」；火豹 [#67](https://github.com/chatfire-AI/huobao-drama/issues/67)：「鏡頭過於細化…想加入**合併分鏡**效果」 | 我們分鏡站是唯讀 table + 兩個 textarea，沒有 CRUD |
| **N9** | **風格要 pin 在 project/episode 層** | 火豹 [#67](https://github.com/chatfire-AI/huobao-drama/issues/67)：「預設日漫賽璐璐風格，但輸出幾個視頻後**畫風變咗**」 | 我們有 `prompts/styles/*` + project.stylePackId — 應該已 pin，值得確認生成路徑真的每次都帶 |
| **N10** | **配音要角色↔音色綁定 + 台詞歸屬可視化** | 火豹 [#85](https://github.com/chatfire-AI/huobao-drama/issues/85)：「同一個人上下鏡頭**音色變咗**」「**主角講咗旁白嘅話**」「配角講咗主角嘅話」 | 呼應審查 #15（配音站零操作）。生成前要給人 review 哪句是誰講 |
| **N11** | **一致性是跨集問題** | LibTV：「喺 **100 集**短劇中保持人物角色一致性係天方夜譚」 | 資產站要是**專案級 canonical 角色庫**，不只單集。我們 Character 已 bind project — 確認跨集復用路徑 |
| **N12** | **per-job stall watchdog** | LibTV wangdu.site：「**唔係報錯，就係卡喺度**」30+ 分鐘 | 我們有頁面級 `stalled`（30s 無 SSE），但沒有 per-job。CLAUDE.md 講 dev 沒有 watchdog —— 這個是真實用戶痛點，不只 infra 潔癖 |

---

## 5. 用研究重排 UIUX 審查的 18 條

| 原編號 | 原嚴重度 | **新嚴重度** | 理由 |
|---|---|---|---|
| #4 成本確認方向反轉 | 🔴 | 🔴🔴 **最高** | 「失敗即燒錢」是四個項目**情緒最強**的一類。但層次要加深 —— 不只「彈窗」，要包含失敗時顯示已燒成本 |
| #8 圖像/視頻站零批量操作 | 🟠 | 🔴 **升** | 火豹「每一個鏡頭生成視頻需要手動，能否自動化」；LibTV 勾選式批量表是他們最順的 UI。量產工具剛需 |
| #1 八站全部同時展開 | 🔴 | 🔴 **維持** | 火豹 v2.0 主動轉「guided wizard, one step at a time」= 第三方驗證 |
| #7 圖像/視頻分兩站 | 🟠 | 🟠 **維持，但改方案** | 不要抄 side-editor（兩個項目都出 stale state 事故，火豹那個直接燒錢）。改抄 LibTV **checkbox spreadsheet** |
| #15 配音站零操作 | 🟡 | 🟠 **升** | 火豹 #85 音色跳/台詞歸錯人是具體 quality bug，不只「唔方便」 |
| #3 blockedBy 沒有 render | 🔴 | 🟠 **降** | 沒有直接競品證據（因為他們根本沒有這個概念）。仍然值得做，但不是血債 |
| #16 空狀態沒有 CTA | 🟡 | 🟠 **升** | 配置/上手流失是火豹 54% issue 的根源。第一次成功生成之前的每一步都是流失點 |
| #5 #6 審核點/毀滅性按鈕 | 🟠 | 🟠 **維持** | waoowaoo #165「撳咗 Esc 成個項目冇咗」印證誤操作代價 |
| #2 文案指錯位置 | 🔴 | 🟠 **降**（但一樣要即刻修） | 純 copy bug，半分鐘的事，無需爭優先次序 |
| #10 成本散四處 | 🟠 | 🟠 **維持** | LibTV 團隊版最大投訴就是成本不可歸因 |
| #11 #12 #13 #14 #17 #18 | 🟡🟢 | **維持** | 沒有新證據推高或推低 |
| #9 三種儲存模型 | 🟠 | 🟠 **維持** | Toonflow #149「switch tab 後編輯丟失」是更嚴重版本；我們至少有存到，只是回饋不一致 |

### 修訂後的落地建議

| 期 | 內容 |
|---|---|
| **P0**（半日） | #2 文案 · #4 成本確認對稱 · #6 拆走毀滅性按鈕 · #13 狀態中文化 · **N1 劇本體檢收斂上限**（查+修） |
| **P0.5**（新增，研究驅動） | **N2 合成跳過失敗鏡頭**（查）· **N5 ModelChip 覆蓋全部生成站** · **模式D 每站「上傳我自己嘅」逃生門**（MediaObject 已有，成本低、四項目共同未解需求 = 最高 ROI） |
| **P1**（1-2 日） | #1 一次一站 + URL param · #11 rail 五態 · #3 blockedBy · #12 FAB 降級 · #10 本集計費卡 |
| **P2**（2-3 日） | #7+#8 鏡頭台 + **checkbox 批量表**（抄 LibTV）· #9 儲存統一 · #15+N10 配音可編輯 · #16 空狀態 · #17 a11y · N8 分鏡表 CRUD |

---

## 6. 差異化總結

**四個項目沒有一個做妥的事**（= 我們的機會）：

1. **第八站成片閉環** —— 全部都要用戶出去用剪映/外部工具拼接
2. **失敗成本透明** —— 沒有一個講得出「呢次失敗燒咗幾多、有冇計費」
3. **每站手動上傳逃生門** —— 四個項目共同的未解需求，我們 MediaObject 已有地基
4. **可自助診斷的錯誤** —— 全部都退化到「加微信群搵人遠程睇」

**他們做對、我們要抄的**：
- LibTV 分鏡 spreadsheet + 第一列 checkbox + 可隱藏欄位 + 批量轉圖
- LibTV 故事板：左列順序排片段、右邊大預覽、逐個檢查
- LibTV per-shot 重生（用戶原話：「省去開盲盒嘅資源浪費」）
- 火豹 v2.0 guided wizard 方向

**他們做錯、我們不要走的**：
- 自由畫布（LibTV 用一個 release 買回結構）
- side-editor 共用 detail pane（兩個項目出 stale state 燒錢事故）
- 靜默模型降級（LibTV）
- 關閉 PR / 單人維護（waoowaoo 13.3k star 社群能量完全浪費）
- 「加群搵人遠程睇」當支援（三個項目全部退化到這一步）

---

## 7. 研究做不到的位（明確講）

- **三個項目的微信群內容全部拿不到** —— 而那裡才是真正的反饋主場。GitHub issue 數量是下限，不是全貌
- **Reddit / HN / Product Hunt：三個 OSS 項目全部 0 命中。** 這些項目的社群 100% 中文，完全沒有西方討論
- **知乎 / CSDN / 騰訊雲直鏈大量 403 / 521 / socket hang up**（反爬）—— 部分內容只拿到搜尋摘要
- **B站評論區拿不到**（JS 渲染）—— Toonflow 官方教學片 BV1oXD7BqEqJ / BV1na6wB6Ea2 的評論區可能是一個未開採的反饋池，值得人手查看
- **LibTV 本身是 SPA + 需登入**，我們沒有親眼見過它的 UI —— 所有 layout 描述是二手
- **LibTV 失敗是否退積分** —— 明確找過，沒有任何來源講到，而這個是最多人問的成本問題
- **linux.do 兩條 waoowaoo 帖 403**（需登入），搜尋摘要似推廣（「已經盈利」「作者用呢套系統做咗約 20 萬元嘅項目」），未能驗證回覆內容
