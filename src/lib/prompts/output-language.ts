// 生圖 prompt 的輸出語言，由第 1 站原文（episode.rawText）決定。
//
// Why: image_prompt_shot 收到的輸入（shot_json、locked_assets、scene_blocking）全部
// 是上游中文 prompt 產出的中文文本。強制輸出英文 = 每一格鏡頭都做一次中→英翻譯，
// 而翻譯本身就是身份漂移源：同一句凍結外貌文本，這一鏡譯成 "ash-grey braided hair"、
// 下一鏡譯成 "silver plaited hair"，模型看到的是兩個人。輸出語言跟原文，翻譯層直接消失。
export type OutputLanguage = "zh" | "en";

// 送進模板 {output_language} 的字面值 —— 模板內的語言分支就是比對這兩個標籤。
export const OUTPUT_LANGUAGE_LABEL: Record<OutputLanguage, string> = {
  zh: "繁體中文",
  en: "英文",
};

// 中日韓統一表意文字（含擴展 A）。標點、假名、注音不算：純日文若無漢字不會誤判成中文，
// 而中文文本一定滿佈這個區段。
const CJK_RE = /[㐀-䶿一-鿿]/g;
const LATIN_RE = /[A-Za-z]/g;

// 中文小說夾英文人名／術語是常態，英文劇本夾一兩個中文字亦然，所以用比例而非「有冇」。
// 0.1 這個門檻兩邊都很鬆：中文原文的 CJK 比例實測 >0.9，英文原文 <0.02，中間空得很闊。
const CJK_RATIO_THRESHOLD = 0.1;
// 太短的樣本（例如只有一句標題）比例會亂跳，直接當「冇信號」交給下一個來源。
const MIN_LETTER_SIGNAL = 12;

/** 單一文本的語言判斷；信號不足回傳 null（不是猜一個）。 */
export function detectTextLanguage(text: string | null | undefined): OutputLanguage | null {
  if (!text) return null;
  const cjk = (text.match(CJK_RE) ?? []).length;
  const latin = (text.match(LATIN_RE) ?? []).length;
  const total = cjk + latin;
  if (total < MIN_LETTER_SIGNAL) return null;
  return cjk / total >= CJK_RATIO_THRESHOLD ? "zh" : "en";
}

/**
 * 依序試每個來源，第一個有信號的說了算。
 * 呼叫端傳 [episode.rawText, episode.scriptText]：原文為準，用戶直接由劇本開始
 * （rawText 空）就退到 scriptText。
 *
 * 全部沒信號時 default "zh"：本平台是香港短劇工具，UI、上游 prompt、locked_assets
 * 全部中文，中文是零翻譯路徑；猜錯成英文才會重新引入這次要消除的翻譯層。
 */
export function resolveOutputLanguage(sources: (string | null | undefined)[]): OutputLanguage {
  for (const s of sources) {
    const hit = detectTextLanguage(s);
    if (hit) return hit;
  }
  return "zh";
}
