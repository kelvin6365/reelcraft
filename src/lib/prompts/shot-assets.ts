export interface RefCharacter {
  name: string;
  aliases?: string[];
  lockedImageMediaId?: string | null;
  faceImageMediaId?: string | null;
  appearancePrompt?: string;
}

export interface RefLocation {
  name: string;
  prompt?: string;
  lockedImageMediaId?: string | null;
}

export interface RefProp {
  name: string;
  prompt?: string;
  lockedImageMediaId?: string | null;
  views?: unknown;
}

const norm = (s: string) => s.normalize("NFKC").trim().toLowerCase();

// 單字名（「王」「李」）做 substring 會亂咬：「王」會咬中「王楚」，
// 「王楚」又會咬中「王」。角色配額得 2 個，多咬一個就白白食走一格。
// 兩邊都夠長先准 substring，唔夠就只准全等。（同 pickShotLocation 一致）
const MIN_FUZZY_LEN = 2;

const looseMatch = (nm: string, w: string) =>
  nm === w || (nm.length >= MIN_FUZZY_LEN && w.length >= MIN_FUZZY_LEN && (nm.includes(w) || w.includes(nm)));

export function matchShotCharacters(shotCharNames: string[], locked: RefCharacter[]): RefCharacter[] {
  const wanted = shotCharNames.map(norm).filter(Boolean);
  if (!wanted.length) return [];
  return locked.filter((c) => {
    const names = [c.name, ...(c.aliases ?? [])].map(norm).filter(Boolean);
    return names.some((nm) => wanted.some((w) => looseMatch(nm, w)));
  });
}

// 鎖定 Location 嘅名係 extract_assets 砌出嚟嘅 `地點·時段`（text-handlers.ts:143），
// 但劇本原文／build_scenes 嘅 scene.location 唔會帶時段後綴。兩邊都剝走先可以比。
const stripTimeOfDay = (s: string) => s.replace(/[·・‧](?:早|日|黃昏|黄昏|夜)\s*$/u, "");
const baseName = (s: string) => norm(stripTimeOfDay(s));
// 單字地點（「屋」「山」）做 substring 會亂咬，只准整名相等 → 共用上面嘅 MIN_FUZZY_LEN

// 揀呢個鏡頭要用邊個鎖定場景嘅參考圖。
// 優先用 build_scenes 寫入 DB 嘅 scene.location（權威來源），撞唔到先退回劇本原文 substring。
// 兩者都撞唔到 → 返 undefined（唔畀場景參考圖）。畀錯場景圖比冇場景圖差好多：
// 冇圖模型會照 prompt 文字描述畫，畀錯圖就會成個鏡頭畫咗喺第二個地方。
//
// ⚠️ 閃回鏡（Shot.flashback）一律唔畀圖，連掃都唔掃。兩條路都唔可以行：
//   ① scene.location 係母場嘅地點（龍巢穴），閃回根本唔喺嗰度 —— 呢個正正就係
//      「兩年前喺電腦前」出咗龍巢穴同死龍嗰個 bug；
//   ② 退回掃 sceneText（母場 summary + content）更加危險 —— 母場原文成篇都係龍巢穴，
//      一掃必定命中，等於換條路撞返同一張錯圖。
// 閃回自己嘅地點文字（Shot.locationOverride，例如「電腦前」）唔喺呢度用：佢係純文字，
// 交畀 formatBlocking 寫入生圖 prompt 做環境描述，唔會夾硬配一張唔啱嘅參考圖。
export function pickShotLocation(
  sceneText: string,
  locked: RefLocation[],
  sceneLocation?: string | null,
  ctx?: { episodeId?: string; sceneId?: string; shotId?: string; flashback?: boolean },
): RefLocation | undefined {
  if (ctx?.flashback) {
    console.warn(
      `[pickShotLocation] 閃回鏡 — episode=${ctx.episodeId ?? "?"} scene=${ctx.sceneId ?? "?"} shot=${ctx.shotId ?? "?"} ` +
        `母場 location=${JSON.stringify(sceneLocation ?? "")} → 唔畀場景參考圖（母場背景一定係錯嘅時空）`,
    );
    return undefined;
  }
  const candidates = locked.filter((l) => l.name.trim() !== "");
  if (candidates.length === 0) return undefined;

  const wanted = baseName(sceneLocation ?? "");
  if (wanted !== "") {
    const exact = candidates.find((l) => baseName(l.name) === wanted);
    if (exact) return exact;
    // 「大地亚龙巢穴外」vs 鎖定「大地亚龙巢穴·日」——兩邊互相包含都算命中，取最長名嗰個
    const contained = candidates
      .filter((l) => {
        const nm = baseName(l.name);
        return nm.length >= MIN_FUZZY_LEN && wanted.length >= MIN_FUZZY_LEN && (nm.includes(wanted) || wanted.includes(nm));
      })
      .sort((a, b) => baseName(b.name).length - baseName(a.name).length)[0];
    if (contained) return contained;
  }

  const hay = baseName(sceneText);
  const inScript = candidates.find((l) => {
    const nm = baseName(l.name);
    return nm.length >= MIN_FUZZY_LEN && hay.includes(nm);
  });
  if (inScript) return inScript;

  console.warn(
    `[pickShotLocation] no location match — episode=${ctx?.episodeId ?? "?"} scene=${ctx?.sceneId ?? "?"} ` +
      `scene.location=${JSON.stringify(sceneLocation ?? "")} locked=[${candidates.map((l) => l.name).join(", ")}] ` +
      "→ 唔畀場景參考圖",
  );
  return undefined;
}

// keyProps 係 storyboard_plan 產出嘅自由文本道具字串（SceneBlocking.keyProps），
// 用同 matchShotCharacters 一樣嘅 fuzzy-name 邏輯揀返呢場戲相關嘅鎖定道具。
export function matchShotProps(keyProps: string[], locked: RefProp[]): RefProp[] {
  const wanted = keyProps.map(norm).filter(Boolean);
  if (!wanted.length) return [];
  return locked.filter((p) => {
    const nm = norm(p.name);
    return nm !== "" && wanted.some((w) => nm === w || nm.includes(w) || w.includes(nm));
  });
}

export interface RefAsset {
  mediaId: string;
  label: string;
  prompt: string;
  // 角色近臉特寫 —— outbound-image 會用高解析度／低壓縮路徑送出（2048 / q92 / 4:4:4），
  // 唔會壓落 1024。塊臉係身份訊號嘅唯一載體，壓縮完 IED 剩返 30-40px 就鎖唔到身份。
  identityAnchor?: boolean;
}

// Gemini 2.5 Flash Image 官方文檔明文：「include a maximum of three images in an input」。
// 超過三張，模型會開始溝身份（多角色鏡頭出現張冠李戴／角色直接消失）。
// 舊註釋引「huobao/waoowaoo both cap ~6」係口耳相傳，冇官方根據，已作廢。
// 一定要喺呢度截斷（唔好留畀 normalizeReferenceImages 靜靜 splice），
// 因為 图片N legend 係按呢個陣列編號嘅，截斷點唔一致就會 legend 同實際圖片錯位。
export const MAX_SHOT_REFS = 3;

// 三格額度：1 格場景 + 2 格角色。道具／場景 angle 圖／角色側背視角一律冇位，
// 佢哋只能靠 prompt 文字描述。
export const MAX_SHOT_CHARACTER_REFS = 2;

export interface ShotRefAssets {
  /** 已 slice 到 MAX_SHOT_REFS，順序 = 實際送出 provider 嘅順序 */
  refs: RefAsset[];
  /** 冇攞到參考圖位嘅角色 —— 下游要改用純文字外貌描述補返身份 */
  droppedCharacters: { name: string; appearancePrompt: string }[];
}

export function buildShotRefAssets(
  shotCharacters: {
    name: string;
    appearancePrompt: string;
    lockedImageMediaId: string | null;
    faceImageMediaId: string | null;
    views?: unknown;
  }[],
  shotLocation:
    | {
        name: string;
        prompt?: string;
        lockedImageMediaId?: string | null;
        angles?: unknown;
      }
    | null
    | undefined,
  _shotProps: RefProp[] = [],
): ShotRefAssets {
  // ⚠️ 排序係硬性要求，唔好「順手」改返轉：
  // Gemini 2.5 Flash Image 官方文檔——「the model will adopt the aspect ratio of the
  // last image provided」。場景鎖定圖同角色鎖定圖而家都跟成品比例生成（場景跟
  // project.videoRatio，角色 9:16，見 media-handlers.ts assetRatio），所以「最後一張」
  // 已經唔再係比例問題。留返呢個排序係為咗身份：角色排最後，模型最後讀到嘅就係
  // identity anchor（面部特寫／全身正面），身份訊號最貼近輸出；場景排最前做空間底圖。
  // （歷史：場景圖曾經係 16:9，最後一張放場景會令出圖燒死黑邊。根因唔係比例——
  // outbound-image 一直有 crop——而係橫構圖被中央裁切後模型自己重建開闊場景再
  // letterbox。已由「場景改原生豎構圖」修好，但呢個排序照樣係啱嘅。）
  const locationRef: RefAsset[] = shotLocation?.lockedImageMediaId
    ? [{ mediaId: shotLocation.lockedImageMediaId, label: `${shotLocation.name}（場景主視角）`, prompt: shotLocation.prompt ?? "" }]
    : [];

  // 每個角色只送一張。優先近臉特寫（faceImageMediaId）——身份靠五官鎖，
  // 近臉比全身更能守住 identity；冇近臉圖先退回全身鎖定圖。
  const characterRefs: RefAsset[] = [];
  const droppedCharacters: { name: string; appearancePrompt: string }[] = [];
  for (const c of shotCharacters) {
    if (characterRefs.length < MAX_SHOT_CHARACTER_REFS && c.faceImageMediaId) {
      characterRefs.push({ mediaId: c.faceImageMediaId, label: `${c.name}（面部特寫）`, prompt: c.appearancePrompt, identityAnchor: true });
      continue;
    }
    if (characterRefs.length < MAX_SHOT_CHARACTER_REFS && c.lockedImageMediaId) {
      characterRefs.push({ mediaId: c.lockedImageMediaId, label: `${c.name}（角色全身正面）`, prompt: c.appearancePrompt });
      continue;
    }
    // 額度用完，或者呢個角色根本一張鎖定圖都冇 → 交畀下游寫成文字描述
    droppedCharacters.push({ name: c.name, appearancePrompt: c.appearancePrompt });
  }

  if (droppedCharacters.length > 0) {
    // 舊版淨係 slice(0, 6)，一聲不響掉走角色，呢個 bug 靜默咗好耐。
    console.warn(
      `[buildShotRefAssets] 角色參考圖額度不足 — 本鏡共 ${shotCharacters.length} 個角色，` +
        `送出 ${characterRefs.length} 個 [${characterRefs.map((r) => r.label).join(", ")}]，` +
        `擋走 ${droppedCharacters.length} 個 [${droppedCharacters.map((c) => c.name).join(", ")}] → 改用文字描述`,
    );
  }

  return { refs: [...locationRef, ...characterRefs].slice(0, MAX_SHOT_REFS), droppedCharacters };
}
