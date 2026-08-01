// 外貌描述（Character.appearancePrompt）過濾——擋走會觸發 provider 內容審查嘅措辭。
//
// 背景：imagePrompt 模板要求角色外貌「照譯勿改寫」逐字帶入（見 media-handlers.ts
// lockedAssets），所以 extract_assets 寫落 DB 嗰句原文會原封不動送去出圖。實測有角色
// 個 appearancePrompt 寫住「露出许多皮肤（尤其是腰部）」，逐字譯入之後直接食
// HTTP_422 content_policy_violation，成個鏡頭 fail（terminal error，唔會重試）。
//
// ⚠️ 設計原則：**只剝走審查詞，唔剝走身份錨。**
// 服裝、髮色、髮型、配件、體型、年齡呢啲係角色跨鏡一致性嘅唯一文字載體，剝咗就等於
// 主動製造角色漂移——比 422 更難察覺。所以分兩層處理：
//
//   1. CLAUSE_PATTERNS —— 成句嘅重點就係「露幾多肉」，冇任何身份資訊，整句掉。
//   2. WORD_PATTERNS   —— 只係一個形容詞黐喺有用嘅句子上（「性感的黑色旗袍」），
//                          淨係刮走個形容詞，保住「黑色旗袍」。
//
// 兩層都刻意寫得窄：寧願漏網一句去到 provider 食 422（可見、可查、可補 pattern），
// 都好過靜靜咁食走角色嘅服裝描述（唔可見、直接壞身份一致性）。

const CLAUSE_PATTERNS: RegExp[] = [
  // 「露出许多皮肤」「裸露大片肌膚」「大面積露膚」
  /(?:露出|外露|裸露|袒露|坦露|展露)[^，,。；;！!？?]{0,6}?(?:皮[肤膚]|肌[肤膚]|身[体體])/u,
  /(?:大面[积積]|大片)[^，,。；;！!？?]{0,4}?(?:露|裸)/u,
  // 明確講身體部位外露
  /(?:露出|外露|裸露|袒露|敞[开開])[^，,。；;！!？?]{0,4}?(?:腰|腹|胸|大腿|臀|後背|后背)/u,
  // 半裸／全裸／赤裸／裸露／衣不蔽體——呢批詞單獨出現已經冇歧義，一律整句掉
  /(?:半裸|全裸|赤裸|裸[体體]|裸露|袒露|衣不蔽[体體]|不著寸縷|不着寸缕)/u,
  // 事業線／乳溝
  /(?:事[业業][线線]|乳[沟溝])/u,
  // 英文：整句都係講暴露程度
  /\b(?:revealing|scantily[\s-]?clad|skimpy|barely[\s-]?covered|see[\s-]?through)\b/i,
  /\b(?:exposed|bare|naked)\s+(?:skin|midriff|waist|belly|torso|chest|cleavage|thighs?|shoulders?\s+and\s+\w+)\b/i,
  /\bcleavage\b/i,
];

// 只刮走個詞，句子其餘部分（服裝／顏色／材質）保住。尾隨嘅「的／嘅」一併食走，
// 唔好留低「的黑色旗袍」呢種爛句。
const WORD_PATTERNS: RegExp[] = [
  /(?:性感|妖[艳艷]|[妩嫵]媚|[诱誘]惑|挑逗|撩人|[风風]骚|[風风]騷)(?:的|嘅)?/gu,
  /\b(?:sexy|seductive|sensual|erotic|provocative|alluring|voluptuous)\b\s*/gi,
];

const SPLIT = /([，,。．.；;！!？?\n]+)/u;

export interface AppearanceFilterResult {
  /** 過濾後嘅文本；全句被剝光時返回空字串，由呼叫方決定點顯示 */
  text: string;
  /** 被剝走嘅原文片段（整句／單詞），純為 log 留痕 */
  removed: string[];
}

export function filterAppearancePrompt(input: string): AppearanceFilterResult {
  if (!input) return { text: "", removed: [] };
  const removed: string[] = [];

  // split 保留分隔符（capture group），先逐句判斷要唔要成句掉。
  const parts = input.split(SPLIT);
  const kept: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const clause = parts[i] ?? "";
    const delim = parts[i + 1] ?? "";
    if (clause.trim() === "") {
      if (clause !== "" || delim !== "") kept.push(clause + delim);
      continue;
    }
    if (CLAUSE_PATTERNS.some((re) => re.test(clause))) {
      removed.push(clause.trim());
      continue; // 連同佢嘅分隔符一齊掉，唔好留低孤兒逗號
    }
    kept.push(clause + delim);
  }

  let text = kept.join("");
  for (const re of WORD_PATTERNS) {
    text = text.replace(re, (m) => {
      removed.push(m.trim());
      return "";
    });
  }

  // 收尾：合併重複空白、清走因為刪句而孤立嘅前導／連續標點。
  text = text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/([，,。．.；;！!？?])\s*(?=[，,。．.；;！!？?])/gu, "")
    .replace(/^[\s，,。．.；;！!？?]+/u, "")
    .trim();

  return { text, removed };
}

// media-handlers 用：過濾 + 留痕。label 用嚟喺 log 度指返邊個資產出事。
export function safeAppearancePrompt(label: string, raw: string): string {
  const { text, removed } = filterAppearancePrompt(raw);
  if (removed.length > 0) {
    console.warn(
      `[appearance-filter] ${label} 外貌描述有 ${removed.length} 段會觸發內容審查嘅措辭，已剝走：` +
        `${removed.map((r) => JSON.stringify(r)).join(", ")} → 送出版本：${JSON.stringify(text)}`,
    );
  }
  return text;
}
