
export interface ErrorAction {
  href: string;
  label: string;
}

export interface ErrorCopyEntry {
  message: string;
  terminal: boolean;
  action?: ErrorAction;
  // Terminal (never auto-retried — looping on a missing key/wrong model is
  // pointless), but the user CAN fix the cause via `action` and then retry. The
  // failure drawer shows a retry button and bulk-retry includes these, so a
  // key-missing pile doesn't stay stuck forever after the key is added.
  recoverable?: boolean;
}

const ERROR_COPY: Record<string, ErrorCopyEntry> = {
  PROVIDER_KEY_MISSING: {
    message: "未連接 AI 供應商金鑰，請先喺設定頁新增對應金鑰，加咗之後可以喺度重試",
    terminal: true,
    recoverable: true,
    action: { href: "/settings", label: "去設定" },
  },
  PROVIDER_UNKNOWN: {
    message: "唔支援嘅 AI 供應商，請聯絡管理員",
    terminal: true,
  },
  MODEL_NO_REFERENCE_SUPPORT: {
    message: "揀咗嘅圖像模型唔支援參考圖，角色一致性會失效 — 請換一個支援參考圖嘅模型，改咗之後可以重試",
    terminal: true,
    recoverable: true,
    action: { href: "/settings", label: "去改模型" },
  },
  PROVIDER_NOT_ALLOWED: {
    message: "呢個供應商喺目前環境唔可用",
    terminal: true,
  },
  PROVIDER_NOT_IMPLEMENTED: {
    message: "呢個供應商仲未支援呢類生成，請改用其他模型",
    terminal: true,
  },
  INVALID_MODEL_KEY: {
    message: "模型設定有誤，請重新選擇模型",
    terminal: true,
  },
  INSUFFICIENT_BALANCE: {
    message: "帳戶餘額不足，請先增值",
    terminal: true,
    action: { href: "/settings/billing", label: "去增值" },
  },
  PROP_NOT_FOUND: {
    message: "劇本入面搵唔到指定嘅道具名，檢查下係咪打錯字，改咗可以重試",
    terminal: true,
    recoverable: true,
  },
  TEMPLATE_NOT_FOUND: {
    message: "找不到對應嘅生成範本，請聯絡管理員",
    terminal: true,
  },
  TEMPLATE_TYPE_MISMATCH: {
    message: "範本設定類型不符，請聯絡管理員",
    terminal: true,
  },
  TEMPLATE_INVALID: {
    message: "生成範本設定有誤，請聯絡管理員",
    terminal: true,
  },
  SOURCE_IMAGE_MISSING: {
    message: "找不到來源圖片，請重新上傳",
    terminal: true,
  },
  REFERENCE_ALL_FAILED: {
    message: "所有參考圖片都處理失敗，請檢查圖片內容",
    terminal: false,
  },
  ENQUEUE_FAILED: {
    message: "任務排隊失敗，請稍後再試",
    terminal: false,
  },
  WATCHDOG_TIMEOUT: {
    message: "任務長時間冇回應，已自動判定失敗，請重試",
    terminal: false,
  },
  UNKNOWN: {
    message: "發生未知錯誤，請重試或聯絡支援",
    terminal: false,
  },
  // guard-allow(no-inline-prompt)
  PROMPT_OVERRIDE_INVALID: {
    message: "自訂 Prompt 同最新變數對唔上，請去模板頁更新或還原官方版",
    terminal: true,
    action: { href: "/settings", label: "去設定" },
  },
};

const PATTERN_COPY: { test: RegExp; entry: ErrorCopyEntry }[] = [
  {
    test: /^(HTTP_429|.*_RATE_LIMIT)/,
    entry: { message: "AI 供應商請求過於頻繁，請稍候再試", terminal: false },
  },
  {
    test: /^HTTP_5\d{2}$|^TEMPLATE_HTTP_5\d{2}$/,
    entry: { message: "AI 供應商服務暫時異常，請稍後再試", terminal: false },
  },
  {
    test: /TIMEOUT/,
    entry: { message: "請求逾時，請稍後再試", terminal: false },
  },
  {
    // 4xx spans key/billing (401/402/403 — fix account or key), bad request
    // (400) and content moderation (422 — edit the prompt). We don't auto-retry
    // (looping won't help) but mark it recoverable so the user can fix the cause
    // and retry, rather than the failure staying stuck with no action.
    test: /^HTTP_4\d{2}$|^TEMPLATE_HTTP_4\d{2}$/,
    entry: { message: "請求被 AI 供應商拒絕（金鑰／額度／內容），修正後可重試", terminal: true, recoverable: true },
  },
];

export interface HumanizedError {
  message: string;
  terminal: boolean;
  action?: ErrorAction;
  recoverable: boolean;
  isFallback: boolean;
}

export function humanizeTaskError(errorCode: string | null | undefined, rawMessage: string | null | undefined): HumanizedError {
  const fallbackMessage = rawMessage || "未知錯誤";

  if (!errorCode) {
    return { message: fallbackMessage, terminal: false, recoverable: false, isFallback: true };
  }

  const exact = ERROR_COPY[errorCode];
  if (exact) {
    return { message: exact.message, terminal: exact.terminal, action: exact.action, recoverable: exact.recoverable ?? false, isFallback: false };
  }

  for (const { test, entry } of PATTERN_COPY) {
    if (test.test(errorCode)) {
      return { message: entry.message, terminal: entry.terminal, action: entry.action, recoverable: entry.recoverable ?? false, isFallback: false };
    }
  }

  return { message: fallbackMessage, terminal: false, recoverable: false, isFallback: true };
}
