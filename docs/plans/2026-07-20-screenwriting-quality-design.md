# 劇本質量五項增強(教材對比落地)

> 日期:2026-07-20|狀態:✅ 已實裝(S1+S2+S3 三條 PR,smoke-pipeline / smoke-plan / smoke-batch 全綠)
> 來源:「劇本工作流」教材對比報告(`~/Projects/screenwriting-workflow-vs-reelcraft.html`)

## 三個缺口 → 三條薄片

### S1 — VO/OS 內心獨白 + 括號演技指示
- 括號約定(全 pipeline 統一):`角色（VO）：`旁白/內心獨白、`角色（OS）：`畫外對白、`角色（冷笑）：`演技 cue、複合 `角色（VO・苦笑）：`。VO/OS 是保留字。
- rewrite_script 不再丟棄內心獨白 → 轉化為 VO 行;voice_analyze 三類全部擷取,輸出 `lineType`(dialogue|vo|os)+ `cue`,emotion 以 cue 為準。
- `VoiceLine.lineType` / `VoiceLine.cue` 欄位;TTS/compose 零改動(VO 仍照常 TTS、仍依 matchedShotId 落軌);VoicePanel 有 VO/OS badge + cue 灰字。
- storyboard_detail 本身已將畫外音→silent 口型,自動兼容。

### S2 — 人物小傳反哺 + 主題錨
- extract_assets 擷取 `age/occupation/personality/painPoint(內心缺失)/backstory(前史)` → `Character.bio` Json(lead/supporting 必填,只允許由劇本推斷)。
- rewrite_script 注入 `{theme}` + `{character_bios}`(formatCharacterBios,空欄跳過)— 第 2 集起使對白符合人物設定,防止全季漂移。
- `Project.theme` 一句中心思想;PlanSetup 有輸入欄;episode_split 切集同樣錨定主題。

### S3 — 劇本體檢站(review-by-exception)
- script_review prompt:逐場檢視檢查清單 → `Episode.scriptReview` Json。
- flags:`no_purpose / unnatural_dialogue / pacing_drag / weak_hook / telling_not_showing`;每場 risk{level,flags,note} + overall 一句總評(必填)。
- SCRIPT_REVIEW task(text queue)、POST `/api/episodes/:id/script-review`、ScriptPanel「🩺 劇本體檢」按鈕 + 🔴🟡🟢 燈號(只展開有問題的場次)。
- **純資訊燈,不是流程閘** — nextAction / batch autorun 完全不受影響。

## 決策記錄
- 教材「分場大綱先行」不採納:輸入是現成小說,兩段生成加倍 token 沒有對應收益;用 S3 體檢補質量。
- migrations 已壓成單一 init(新階段項目,用戶授權清 DB)。
- smoke scripts 強制設定 `MODEL_DEFAULTS_PRESET=fake`,測試永不觸碰真實 provider。
