# 貢獻指南

歡迎 issue 與 PR。這個專案由 solo 開發者搭配 AI agents 維護，因此**架構不變式以腳本強制**而非靠人記——動手前請先讀 [CLAUDE.md](CLAUDE.md)（八條鐵律）與 [docs/tech/](docs/tech/README.md)（實作級 spec）。

## 開發環境

```bash
git clone https://github.com/kelvin6365/reelcraft && cd reelcraft
npm install
npm run dev     # 自動偵測環境、建立 .env、完成資料庫設定
```

沒有 Postgres 也可以：bootstrap 會落 **local 模式**（SQLite + 本機檔案 storage + 內嵌 worker，單一 process、零 Docker）。沒有 provider key 也可以：bootstrap 會設 `MODEL_DEFAULTS_PRESET=fake`，全程走 fake provider，**不產生任何費用**。

需求：Node ≥ 20.9（開發於 22 LTS）、ffmpeg（合成必需）。

## 提交前必跑

```bash
npm run check   # 17 個架構 guard + typecheck
npm test        # 771 個單元測試
```

CI（[.github/workflows/ci.yml](.github/workflows/ci.yml)）會跑同樣兩條，外加離線全管線 E2E（`npm run smoke:pipeline:local`，小說 → mp4，fake providers）。

改動觸及管線接縫（站與站之間怎麼接上）時，請在本機跑一次 E2E：

```bash
npm run smoke:pipeline:local
```

> ⚠️ 這個 script 會把 repo 的 Prisma client 重新生成到 SQLite schema。跑完要回 Postgres 開發環境，執行 `npx prisma generate` 還原。

## PR 慣例

- **每個 PR 一條薄片** — 交付必須貫通「貼文 → 出成品」的某一段，不做半截的鋪墊。
- **新增架構決策的 PR 必須附一個 guard 腳本**（`scripts/guards/*.mjs`），這是 review checklist 的第一條。Guard = 純 Node、無依賴、靜態掃描 `src/`，違規時印出檔案 + 行號後 `exit 1`；開頭要有一句註解說明「保護哪條決策、為何而設」。新增檔案即自動生效（`scripts/check.mjs` 自動掃描目錄，無須註冊）。
- **Prompt 不准 inline 寫在 code 中** — 放 `prompts/pipeline/`，並同步加 `prompts/catalog.json` 條目（id / path / version / variables）與 `prompts/canary/*.canary.json` 樣本鎖住關鍵約束句。`prompt-catalog-sync` guard 會驗這三者一致。
- **改了 schema.prisma** — 跑 `node scripts/gen-sqlite-schema.mjs` 同步 SQLite 變體（`sqlite-schema-sync` guard 會驗），並手寫 migration 放入 `prisma/migrations/`。
- **改了 `src/lib/env.ts` 的 zod keys** — 同步 `.env.example`（`env-example-sync` guard 會驗）。

## 程式碼風格

- 語言分工：**UI 文案**為繁體中文（粵語風味）、**文檔**為標準書面繁體中文、**code 與 identifier** 為英文。
- 註解寫「為什麼」不寫「做什麼」。特別是**曾經踩過的坑**——註解裡的一句「呢度唔可以用 X，因為 Y」，價值高於十行說明程式碼在做什麼。
- 不要靜默降級。能力不匹配、資料缺漏、模型輸出不合格，一律明確失敗並講清楚原因。這個 codebase 大部分最貴的缺陷都來自「靜靜地退回預設值」。

## 授權注意

參考項目 huobao-drama（CC BY-NC-SA）、Toonflow（Apache + 商業限制）、waoowaoo（CC BY-NC-SA）的**程式碼與 prompt 原文一律不得複製**——只使用架構模式與思想，全部從零實作。提交前請自我檢查你的 PR 沒有引入任何來自這些專案的原文。

## 回報問題

- **一般 bug / 功能建議**：開 issue，附上重現步驟與 `npm run check` / `npm test` 的輸出。
- **安全漏洞**：請勿開公開 issue，見 [SECURITY.md](SECURITY.md)。

## 授權

提交 PR 即表示你同意你的貢獻以 [AGPL-3.0](LICENSE) 授權釋出。
