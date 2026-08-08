// 空間契約（SceneBlocking）逐鏡過濾 —— 契約係**一場一份**，但生圖係**一鏡一次**。
//
// 背景：storyboard_plan 為成場戲鎖一份空間契約（軸線、每個角色嘅落位、關鍵道具狀態），
// image_prompt_shot.zh.txt 寫明契約要「硬性遵守」。原本 handler 把成份契約原封不動塞入
// 每一鏡嘅 prompt，即係一鏡淨係得兩個角色，模型照樣收到五個人嘅落位 + 五件道具嘅狀態，
// 而且個模板叫佢硬性遵守。
//
// 實測後果（第 11 鏡）：characters 已經鎖死做 ["鄭夏雨","王楚"]，出圖仍然多咗三個雜兵、
// 法杖塞咗畀王楚（契約本身寫錯持有者）、仲畫埋第 1 鏡嗰個「舉劍聖光巨龍倒塌」。即係話
// 我哋喺 characters 層做嘅所有防線（截 ≤2、剝 subject、附加無名群眾指令）**全部被契約
// 繞過**——因為契約唔經 characters，係另一條路直接落到生圖 prompt。
//
// 所以過濾一定要喺呢度做：把契約收窄到本鏡真係在場嗰幾個人先傳落去。
// ⚠️ cameraAxis 唔過濾 —— 180 度軸線係**成場共用**嘅，佢正正就係跨鏡連戲嘅唯一依據，
// 剝走佢等於親手拆咗連戲。
//
// 同 text-handlers 嗰幾層一樣：唔准 throw、唔准令鏡頭 fail。契約對唔上唔係錯誤，
// 過濾到空都照行（formatBlocking 有 fallback 文案）。

export interface BlockingPosition {
  name: string;
  screenSide?: string;
  facing?: string;
  placement?: string;
}

export interface SceneBlocking {
  cameraAxis?: string;
  positions?: BlockingPosition[];
  keyProps?: string[];
}

const norm = (s: string) => s.normalize("NFKC").trim().toLowerCase();

// blocking 由模型嘅 JSON 直接落 DB（Prisma Json 欄位），行到呢度乜嘢形狀都可能。
// 一律先正規化成已知結構，之後嘅過濾就唔使逐處防 undefined／非陣列。
export function parseBlocking(raw: unknown): SceneBlocking {
  const b = (raw ?? {}) as SceneBlocking;
  return {
    cameraAxis: typeof b.cameraAxis === "string" ? b.cameraAxis : "",
    positions: Array.isArray(b.positions) ? b.positions.filter((p) => p && typeof p.name === "string") : [],
    keyProps: Array.isArray(b.keyProps) ? b.keyProps.filter((p): p is string => typeof p === "string") : [],
  };
}

export interface BlockingFilterResult {
  /** 收窄到本鏡嘅契約，可以直接餵 formatBlocking */
  blocking: SceneBlocking;
  /** 被剝走嘅落位（角色名），純為 log 留痕 */
  droppedPositions: string[];
  /** 被剝走嘅 keyProps 原文，純為 log 留痕 */
  droppedProps: string[];
}

// positions 用**全等**（NFKC + trim + lowercase）而唔係 substring 比對。
// 呢度刻意唔學 matchShotCharacters 嗰種 fuzzy：fuzzy 嘅誤判方向係「多留一個人」，
// 而多留一個人正正就係我哋要修嗰個 bug（「王楚」嘅落位會被「王楚天」留低）。
// 名對唔上就剝走 —— 少一個落位嘅代價只係模型自己揀個位，多一個落位嘅代價係憑空多一個人。
// 而且 positions 同 characters 本來就係同一次 storyboard_plan 呼叫嘅輸出，名一定同源。
//
// 閃回鏡（opts.flashback）例外：**成份契約剝走，連 cameraAxis 都剝**。
// 上面嗰句「軸線唔過濾」係對住同一場戲講嘅 —— 軸線之所以係連戲嘅根，前提係前後鏡拍緊
// 同一個空間。閃回鏡唔喺母場嗰個空間（母場軸線寫住「鏡頭一律喺洞口一側」，而閃回係兩年前
// 屋企電腦前），把佢硬套落去唔係連戲，係把一句唔相干嘅硬性指示塞畀模型。落位同道具更加
// 唔使講：母場邊個企畫面左、條龍倒咗，全部同閃回無關。
// 剝到淨低乜都冇 → formatBlocking 會出 NO_BLOCKING，嗰句本身已經叫模型保持左右關係
// 一致唔越軸，啱啱好就係閃回鏡之間應該守嘅嘢。
export function filterBlockingForShot(
  raw: unknown,
  shotCharNames: string[],
  knownCharacterNames: string[] = [],
  opts?: { flashback?: boolean },
): BlockingFilterResult {
  const b = parseBlocking(raw);
  if (opts?.flashback) {
    return {
      blocking: { cameraAxis: "", positions: [], keyProps: [] },
      droppedPositions: (b.positions ?? []).map((p) => p.name),
      droppedProps: b.keyProps ?? [],
    };
  }
  const inShot = new Set(shotCharNames.map(norm).filter(Boolean));

  const allPositions = b.positions ?? [];
  const positions = allPositions.filter((p) => inShot.has(norm(p.name)));
  const droppedPositions = allPositions.filter((p) => !inShot.has(norm(p.name))).map((p) => p.name);

  // keyProps 策略：**剝走提到「本鏡唔在場嘅人」嘅道具**，其餘一律保留。
  //
  // 點解係「有外人就剝」而唔係「冇本鏡角色就剝」：契約入面「巨龍=倒塌」呢類冇持有者
  // 嘅道具係真正嘅全場連戲資訊（呢場戲入面條龍就係死咗），逐鏡保留先啱；而「艾琳的弓=
  // 手中握著」講嘅係一個唔喺本鏡嘅人手上攞住乜——模型收到之後就要把艾琳畫返入去先
  // 交到差。前者留，後者剝，準則就係「有冇提到唔在場嘅人」。
  //
  // 名單要連契約自己列出嘅落位名一齊當人名認：有啲配角有落位但未必抽咗做鎖定角色，
  // 淨靠 knownCharacterNames 會漏。
  const keptNames = [...shotCharNames, ...positions.map((p) => p.name)].map((n) => n.trim()).filter(Boolean);
  const outsiders = [...new Set([...knownCharacterNames, ...allPositions.map((p) => p.name)])]
    .map((n) => n.trim())
    .filter((n) => n !== "" && !inShot.has(norm(n)))
    // 名互為子串（「王楚」vs「王楚天」）時，短嗰個唔可以攞嚟做剝除依據 ——
    // 「王楚天的劍」會被「王楚」咬中，剝走一件真係喺本鏡嘅道具。同
    // stripDroppedFromSubject 一樣嘅取捨：方向保守，寧願漏剝。
    .filter((n) => !keptNames.some((k) => k !== n && k.includes(n)));

  const allProps = b.keyProps ?? [];
  const mentionsOutsider = (prop: string) => outsiders.some((n) => prop.includes(n));
  const keyProps = allProps.filter((p) => !mentionsOutsider(p));
  const droppedProps = allProps.filter(mentionsOutsider);

  return {
    blocking: { cameraAxis: b.cameraAxis, positions, keyProps },
    droppedPositions,
    droppedProps,
  };
}

const SIDE_LABEL = (s?: string) => (s === "left" ? "畫面左" : s === "right" ? "畫面右" : "畫面中");

// 完全冇契約（模型冇出 blocking，或者一場都冇軸線冇落位）先用呢句。
const NO_BLOCKING = "（無空間契約——保持前後鏡頭的左右關係與視線方向一致，不越軸）";
// 有軸線但過濾之後一個落位都唔剩（例如空鏡、物件鏡、或者契約名同 characters 對唔上）。
// 軸線一定要留（成場共用，連戲嘅根），但唔可以留低一句「軸線：…；」嘅爛尾字串 ——
// 模板會把契約當硬性指示讀，一段空白等於叫模型自己填。
const NO_POSITIONS = "（本鏡無指定角色落位——按本鏡 subject 自行安排，但左右關係與視線方向須與前後鏡一致）";

// 閃回鏡專用嘅開頭句。呢個係閃回鏡唯一一次把「佢喺邊」講畀生圖模型聽嘅機會 ——
// 佢冇場景參考圖（pickShotLocation 一律唔畀），所以環境完全押喺呢段文字上面。
// 明確叫佢**唔好**沿用本場環境：唔講嘅話，模型會由 shot_json 入面嘅 subject 同對白
// 推返個「主場景」出嚟（實測就係咁畫返個龍巢穴出嚟）。
function flashbackLine(locationOverride: string): string {
  const where = locationOverride.trim();
  return (
    "（本鏡屬閃回／回憶／夢境，唔喺本場嘅時空——" +
    (where ? `地點：${where}。` : "原文冇明講地點，按本鏡 subject 自行交代一個唔同於本場嘅環境。") +
    "嚴禁沿用本場嘅場景、背景或空間佈局；本場空間契約不適用，但閃回鏡之間仍須保持左右關係與視線方向一致，不越軸）"
  );
}

export function formatBlocking(raw: unknown, opts?: { flashback?: boolean; locationOverride?: string }): string {
  if (opts?.flashback) return flashbackLine(opts.locationOverride ?? "");
  const b = parseBlocking(raw);
  if (!b.cameraAxis && !b.positions?.length) return NO_BLOCKING;
  const pos = (b.positions ?? [])
    .map((p) => `${p.name}=${SIDE_LABEL(p.screenSide)}${p.facing ? `、${p.facing}` : ""}${p.placement ? `、${p.placement}` : ""}`)
    .join("；");
  const props = b.keyProps?.length ? `；道具：${b.keyProps.join("、")}` : "";
  return `軸線：${b.cameraAxis || "不越軸"}；${pos || NO_POSITIONS}${props}`;
}
