// 鏡頭生圖 prompt 事後審計 —— L2 確定性守衛（見 docs/plans/2026-08-03-delivery-standards-design.md §2）。
//
// 點解要喺 handler 做，唔可以淨係喺 prompt 講：
// image_prompt_shot.zh.txt 明文寫住「本鏡每個出鏡角色都要把外貌描述寫入 prompt，冇寫＝失敗」，
// 亦寫住無名群眾唔准畫成可辨認面孔（仲附咗反面例子「實測出咗四個一模一樣嘅金髮騎士」）。
// 實測 episode 019fb890…51907 鏡 25：兩條規則同時被 text model 靜默無視 ——
// 郑夏雨喺 plan.characters 入面、喺空間契約入面、有 Image 2 參考圖，但成條 prompt 冇提過佢一次。
//
// 後果唔係「少咗一個角色」咁簡單，係**孤兒參考圖**：Image 2（金髮紅甲身份圖）照樣送咗畀生圖
// 模型，但文字層完全冇嘢綁住佢。生圖模型收到一張冇人認領嘅身份圖，加上一個冇匿名化嘅集體
// 名詞「幾名女性隊員」，就把前者貼落後者度，貼咗四次 —— 四個一模一樣嘅郑夏雨複製人。
//
// 所以核心不變式係：**送出去嘅每一張參考圖，prompt 入面都必須有 `Image N` 綁住佢。**
// 冇文字錨定嘅身份圖比冇圖差好多（冇圖模型會照文字描述畫，有孤兒圖就會亂認人）。
// 呢個檢查係純字串比對，語言無關 —— 中文英文輸出都一樣可靠，唔使靠角色名比對。

/** `Image N` 係模板硬性規定嘅英文序數格式（中文輸出都一樣），所以只認呢一種寫法。 */
const IMAGE_REF_SOURCE = "\\bImage\\s*(\\d+)\\b";
const imageRefRe = () => new RegExp(IMAGE_REF_SOURCE, "g");

/** prompt 入面實際引用咗嘅參考圖編號（1-based）。 */
export function referencedImageIndexes(prompt: string): Set<number> {
  const out = new Set<number>();
  for (const m of prompt.matchAll(imageRefRe())) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return out;
}

export interface RefLike {
  label: string;
}

export interface OrphanDropResult<T extends RefLike> {
  /** 重新編號後嘅 prompt（冇嘢剝走就原樣返回） */
  prompt: string;
  /** 保留低嘅參考圖，次序不變 */
  refs: T[];
  /** 被剝走嘅參考圖 label，純為 log 留痕 */
  droppedLabels: string[];
  /** prompt 引用咗但根本唔存在嘅編號（模型作嘅），純為 log 留痕 */
  strayIndexes: number[];
}

/**
 * 剝走冇被 prompt 引用嘅參考圖，並把餘下嘅 `Image N` 重新編號。
 *
 * ⚠️ 重新編號唔可以慳 —— refs 陣列同 `Image N` 係位置耦合嘅。剝走 Image 2 之後，
 * 原本第 3 張會變成送出去嘅第 2 張，但 prompt 仲寫住 `Image 3`，即係由「指錯人」
 * 變成「指去空氣」，比唔剝更差。
 *
 * 用單次 replace 而唔係逐個 index 循環替換：單次 replace 每個 match 只消費一次，
 * 唔會出現「3→2 之後又被當成 2 再改一次」嗰種連鎖改寫。
 */
export function dropOrphanRefs<T extends RefLike>(prompt: string, refs: T[]): OrphanDropResult<T> {
  const referenced = referencedImageIndexes(prompt);
  const strayIndexes = [...referenced].filter((n) => n > refs.length).sort((a, b) => a - b);
  const isKept = (i: number) => referenced.has(i + 1);

  if (refs.every((_, i) => isKept(i))) {
    return { prompt, refs, droppedLabels: [], strayIndexes };
  }

  const remap = new Map<number, number>();
  let next = 0;
  refs.forEach((_, i) => {
    if (isKept(i)) remap.set(i + 1, ++next);
  });

  return {
    prompt: prompt.replace(imageRefRe(), (whole, digits: string) => {
      const to = remap.get(Number(digits));
      return to === undefined ? whole : `Image ${to}`;
    }),
    refs: refs.filter((_, i) => isKept(i)),
    droppedLabels: refs.filter((_, i) => !isKept(i)).map((r) => r.label),
    strayIndexes,
  };
}

/**
 * 本鏡角色有邊個完全冇出現喺 prompt 入面。
 *
 * ⚠️ 只喺中文輸出可靠。英文輸出之下模板要求角色名寫成羅馬拼音
 * （`Zheng Xiayu (the blonde young woman in Image 1)`），中文名一定 miss，
 * 逐個當成「漏寫」就會無限重試。有參考圖嗰啲角色靠 dropOrphanRefs 守（語言無關），
 * 呢個 helper 淨係補返「冇參考圖、只能靠文字交代身份」嗰批。
 */
export function missingCharacterNames(prompt: string, names: string[]): string[] {
  return names.filter((n) => n.trim().length > 0 && !prompt.includes(n));
}

export interface ShotPromptIssues {
  /** 送咗圖但 prompt 冇引用 —— 會令生圖模型亂認人，最嚴重 */
  orphanLabels: string[];
  /** 冇參考圖又冇喺 prompt 出現嘅角色（只喺中文輸出計算） */
  missingNames: string[];
}

export function auditShotPrompt<T extends RefLike>(
  prompt: string,
  refs: T[],
  textOnlyCharacterNames: string[],
  opts: { checkNames: boolean },
): ShotPromptIssues {
  const referenced = referencedImageIndexes(prompt);
  return {
    orphanLabels: refs.filter((_, i) => !referenced.has(i + 1)).map((r) => r.label),
    missingNames: opts.checkNames ? missingCharacterNames(prompt, textOnlyCharacterNames) : [],
  };
}

export const hasIssues = (i: ShotPromptIssues) => i.orphanLabels.length > 0 || i.missingNames.length > 0;
