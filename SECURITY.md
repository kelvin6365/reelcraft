# 安全政策

## 回報漏洞

**請勿開公開 issue 回報安全問題。**

請使用 GitHub 的 [Private vulnerability reporting](https://github.com/kelvin6365/reelcraft/security/advisories/new)（Security 分頁 → Report a vulnerability），或直接電郵維護者。

回報時請盡量附上：

- 受影響的版本 / commit
- 重現步驟或 PoC
- 你評估的影響範圍（資料外洩？越權？費用被濫用？）

我們會在 **72 小時內**回覆確認收到，並在修復後於 release note 致謝（除非你希望匿名）。

## 支援版本

本專案尚未發佈穩定版本；安全修復只針對 `main` 分支。

## 這個專案特別在意的攻擊面

如果你要找洞，以下幾處是設計上最敏感的地方：

| 面向 | 不變式 | 相關程式碼 |
|---|---|---|
| **多租戶隔離** | 所有資料表帶 `userId`，所有查詢以 `userId` 收窄。跨租戶讀寫任何一列都是嚴重漏洞 | `src/app/api/**`、`src/lib/api/with-auth.ts` |
| **BYO-Key 保護** | 使用者的 provider 金鑰以信封加密儲存（`API_ENCRYPTION_KEY`）；**API 永不回傳明文金鑰**，只回傳遮罩後的尾碼 | `src/lib/ai/provider-key.ts`、`src/lib/crypto-keys.ts` |
| **媒體存取** | DB 只存 storage key，不存 URL；讀取時才簽發短期簽名 URL。任何可以讓別人猜到／列舉他人 storage key 的路徑都算漏洞 | `src/lib/media/service.ts` |
| **費用濫用** | 每個生成任務都有配額（併發 + 每日上限）與預算護欄。可以繞過閘直接觸發大量付費生成的路徑，等同於財務漏洞 | `src/lib/billing/`、`src/lib/quota/` |
| **Prompt 注入** | 使用者貼上的小說原文會進入 LLM prompt。能藉此讓模型改寫系統指令、洩漏其他租戶資料、或引導產出違法內容的手法，我們想知道 | `prompts/`、`src/lib/prompts/` |
| **SSRF / 出站抓取** | 生成流程會抓取 provider 回傳的媒體 URL。任何可以讓使用者控制的值變成內網請求的路徑 | `src/lib/media/service.ts`、`src/lib/ai/outbound-image.ts` |

## 部署者請注意

自行部署時，以下值**必須**更換，否則等同於沒有加密：

| 環境變數 | 風險 |
|---|---|
| `API_ENCRYPTION_KEY` | 預設值是 dev 佔位字串。不換 = 所有使用者的 provider 金鑰形同明文 |
| `BETTER_AUTH_SECRET` | 不換 = session 可被偽造 |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | 預設是 MinIO dev 憑證 |
| `DATABASE_URL` | 預設指向本機 dev 資料庫 |

生產環境另建議：`STORAGE_TYPE` 改用 S3 相容雲端儲存（而非本機檔案）、於反向代理層加 TLS、並依實際成本上限調整 `QUOTA_*` 與 `BILLING_MODE`。
