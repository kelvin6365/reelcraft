// 閃回／回憶／夢境 —— 鏡頭層標記，唔再切場。
//
// 【點解推翻上一輪嘅切場做法】
// 上一輪（splitFlashbackScenes，已刪）把夾住閃回嘅場景程式切成「現在／閃回／現在」三場。
// 佢確實解決咗「兩年前嘅閃回攞咗龍巢穴同死龍做背景」，但實跑《功課1》之後，代價比佢
// 解決嗰樣嘢貴：
//   ① 同一個實體地點（大地亞龍巢穴）被切成場 1／3／5，物理上同一場戲。每場各自跑一次
//      storyboard_plan，各自鎖一份空間契約 → 三份互不相干嘅軸線同落位 → 角色左右位、
//      180° 軸線冇任何保證一致，剪埋一齊就跳軸。跳軸係睇得出嘅硬傷，而且冇得後補。
//   ② 切出嚟嘅碎片冇原文錨點（anchorStart／anchorEnd 留空）—— 追溯唔返原文，
//      做唔到增量重跑。
//   ③ 母場嘅 summary 被複製落每個碎片（六場有五場一模一樣），而 pickShotLocation
//      嘅 fallback 讀嘅正正就係 summary + content，等於少咗一層保護。
//   ④ 閃回場 location 一律留空，連原文寫得好清楚嘅「王楚坐在電腦前」都白白丟棄。
// 上一輪嘅偵測邏輯（認括號旁白標記）本身冇錯，錯嘅係佢嘅作用層。所以偵測搬落嚟呢度，
// 作用層由「場」降到「鏡」：母場保持完整（一份空間契約、有錨點、summary 各自唔同），
// 閃回鏡頭逐個標記，落到生圖層先至剝走母場嘅場景參考圖同空間契約。
//
// 【點解偵測落 code 而唔係淨靠 prompt】
// build_scenes.zh.txt 為咗「時空跳躍即切場」改咗兩次 prompt（加硬性規則、加觸發信號清單、
// 加實測後果），兩次重跑都仍然係 2 場 —— 模型把「一場約 20 個元素」嘅配額當成可以壓過
// 硬性規則。呢個 session 反覆驗證嘅教訓：prompt 規則係軟約束，凡係唔可以飄嘅嘢最終都要
// 落 code 硬做。所以「邊幾鏡係閃回」由呢度確定性判定；prompt 嗰邊只負責一件飄咗都唔會
// 靜默壞嘅事——講出閃回本身嘅地點文字（「電腦前」），程式抽唔到嘅自由文本。
//
// 同 text-handlers／shot-blocking 一致：唔准 throw、唔准令 scene／shot fail。
// 認唔到就當唔係閃回，所有確定性判斷都 console.warn 留痕。

// ⚠️ 只認括號旁白註記，唔認散文入面嘅「兩年前」。「兩年前他就是這樣說的」係對白入面嘅
// 時間狀語，唔係畫面跳轉；照認就會把成場戲嘅鏡頭誤標成閃回，反而剝走佢哋真正需要嘅
// 場景參考圖。方向保守：寧願漏網（背景錯咗睇得到），都唔好誤標（靜默剝走參考圖）。
const FLASHBACK_OPEN = /[（(][^（()）]*?(?:闪回|閃回|回忆|回憶|梦境|夢境|梦中|夢中|倒叙|倒敘)[^（()）]*[）)]/g;
// 回切註記本身屬於「回到現在」嗰段（佢係嗰段嘅第一句），所以閃回段止喺佢**之前**。
const FLASHBACK_CLOSE =
  /[（(][^（()）]*?(?:回到现在|回到現在|回到当下|回到當下|画面拉回|畫面拉回|镜头拉回|鏡頭拉回|镜头回到|鏡頭回到|闪回结束|閃回結束)[^（()）]*[）)]/g;

export interface FlashbackRange {
  /** 原文 offset，含 */
  start: number;
  /** 原文 offset，不含 */
  end: number;
}

// 掃出一段原文入面所有閃回區間。
// 有回切註記 → 閃回一路去到嗰度（覆蓋跨段閃回）；冇 → 閃回就只係嗰個括號段本身。
// 冇回切註記嗰陣點解唔一路食到段尾：食過龍就會把「回過神來走入巢穴」嗰批現在鏡頭
// 一齊標成閃回，佢哋就冇咗場景參考圖 —— 呢個誤判方向比漏網貴。
export function flashbackRanges(content: string): FlashbackRange[] {
  const ranges: FlashbackRange[] = [];
  if (!content) return ranges;

  const opens = [...content.matchAll(FLASHBACK_OPEN)];
  const closes = [...content.matchAll(FLASHBACK_CLOSE)];
  for (const open of opens) {
    const start = open.index ?? 0;
    const openEnd = start + open[0].length;
    // 已經喺上一個區間入面（例如「（闪回）…（梦境）…（回到现在）」）→ 唔重複開區間
    if (ranges.some((r) => start < r.end)) continue;
    const close = closes.find((c) => (c.index ?? 0) >= openEnd);
    ranges.push({ start, end: close ? (close.index ?? openEnd) : openEnd });
  }
  return ranges;
}

/** storyboard_plan 一個鏡頭入面同閃回判定有關嗰幾個欄位（其餘欄位唔關事） */
export interface FlashbackCandidateShot {
  index: number;
  source_text?: string;
  flashback?: boolean;
  flashback_location?: string;
}

export interface FlashbackMark {
  /** 呢一鏡唔屬於母場嘅時空 */
  flashback: boolean;
  /** 閃回自己嘅地點文字（純文字，唔用嚟配參考圖）；認唔出就空字串 */
  locationOverride: string;
}

// 閃回地點文字只會餵落生圖 prompt 做一句環境描述，唔係一段場景設定。
// 截短係為咗擋模型把成段劇情寫入嚟（實測模型會把「地點」欄位當成 summary 用）。
const MAX_LOCATION_OVERRIDE = 40;

// source_text 定位失敗時嘅退路：按鏡頭次序均分原文。定位失敗通常係模型改寫咗原文
// （source_text 要求「可被追溯回原文」，但佢會順手潤色），呢個時候鏡頭嘅相對次序
// 仍然可信，所以按比例落位好過一律當唔係閃回。
function proportionalMid(total: number, i: number, contentLength: number): number {
  if (total <= 0) return 0;
  return Math.floor(((i + 0.5) / total) * contentLength);
}

// 喺原文搵返呢一鏡對應嗰段文字。cursor = 上一鏡搵到嘅位置，令重複句（「他點頭。」）
// 唔會全部撞返第一次出現嗰度。
function locate(content: string, sourceText: string, cursor: number): { start: number; end: number } | null {
  const probe = sourceText.trim();
  if (probe === "") return null;
  for (const needle of [probe, probe.slice(0, 12), probe.slice(0, 6)]) {
    if (needle.length < 4) break; // 太短就會亂咬，唔值得試
    const at = content.indexOf(needle, cursor);
    const found = at >= 0 ? at : content.indexOf(needle);
    if (found >= 0) return { start: found, end: found + probe.length };
  }
  return null;
}

// 逐鏡判定閃回。回傳同 shots 同長同序嘅標記陣列。
//
// 最終標記 = 程式判定 OR 模型自報。點解 OR 而唔係淨信一邊：
// - 程式判定係硬底線，模型飄咗都擋得住（呢個係推翻 prompt 路線嘅原因）；
// - 但程式只認括號註記，冇括號嘅閃回（純靠「兩年前」敘述）佢一定漏，模型反而睇得出。
// - 兩個方向嘅誤判代價唔對稱：誤標成閃回 = 冇場景參考圖（中性背景，睇得出、改得返）；
//   漏標 = 用錯背景（靜默壞，成個鏡頭畫咗喺第二個地方）。所以取寬鬆嗰邊。
// 唯一例外見下面 modelRunaway：模型把成場都標做閃回而原文一個註記都冇，就係佢失控，
// 照收就會令成場戲冇晒場景參考圖。
export function markFlashbackShots(
  sceneId: string,
  sceneContent: string,
  shots: FlashbackCandidateShot[],
): FlashbackMark[] {
  const ranges = flashbackRanges(sceneContent);
  const modelFlagged = shots.filter((s) => s.flashback === true).length;
  // 冇任何括號註記 + 模型話「成場都係閃回」→ 唔信佢。母場成場係閃回呢件事本身唔係
  // 唔可能（LLM 真係切啱一場閃回場），但嗰種情況原文一定有註記，行唔到呢一條。
  const modelRunaway = ranges.length === 0 && modelFlagged === shots.length && shots.length > 1;
  if (modelRunaway) {
    console.warn(
      `[flashback] scene=${sceneId} 模型把全部 ${shots.length} 鏡都標做閃回，但原文冇任何閃回註記 — ` +
        "當佢失控，全部當非閃回處理（照收就等於成場戲冇晒場景參考圖）",
    );
  }

  const marks: FlashbackMark[] = [];
  let cursor = 0;
  let unlocated = 0;
  for (const [i, shot] of shots.entries()) {
    const src = shot.source_text ?? "";
    const hit = locate(sceneContent, src, cursor);
    if (hit) cursor = hit.start;
    else unlocated++;
    const mid = hit ? hit.start + Math.floor((hit.end - hit.start) / 2) : proportionalMid(shots.length, i, sceneContent.length);

    // 中點落喺閃回區間 = 呢一鏡主體屬於閃回。用中點而唔係任何重疊：一個橫跨邊界嘅
    // 鏡頭（「他回過神來」嗰句往往連住括號）應該歸去佔多數嗰邊。
    const byRange = ranges.some((r) => mid >= r.start && mid < r.end);
    // source_text 自己帶住開場註記 → 一定係閃回，唔使理定位準唔準。
    const bySource = FLASHBACK_OPEN.test(src);
    FLASHBACK_OPEN.lastIndex = 0; // /g regex 嘅 test() 會記住位置，唔重置就下一鏡漏認
    const byModel = shot.flashback === true && !modelRunaway;

    const flashback = byRange || bySource || byModel;
    const locationOverride = flashback ? (shot.flashback_location ?? "").trim().slice(0, MAX_LOCATION_OVERRIDE) : "";
    marks.push({ flashback, locationOverride });

    if (flashback) {
      console.warn(
        `[flashback] scene=${sceneId} shot=${shot.index} 標記為閃回（` +
          [byRange ? "原文括號註記區間" : "", bySource ? "source_text 帶註記" : "", byModel ? "模型自報" : ""]
            .filter(Boolean)
            .join("＋") +
          `）— 唔會用母場嘅場景參考圖同空間契約；閃回地點文字：${locationOverride || "（認唔出）"}`,
      );
    }
  }

  if (unlocated > 0) {
    console.warn(
      `[flashback] scene=${sceneId} ${unlocated}/${shots.length} 鏡嘅 source_text 喺原文搵唔返（模型改寫咗）— ` +
        "呢幾鏡改用鏡頭次序按比例落位判斷閃回，精度較低",
    );
  }
  return marks;
}
