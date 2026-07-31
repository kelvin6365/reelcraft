import type { LocationAngle } from "@/lib/prompts/location-angles";

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

export function matchShotCharacters(shotCharNames: string[], locked: RefCharacter[]): RefCharacter[] {
  const wanted = shotCharNames.map(norm).filter(Boolean);
  if (!wanted.length) return [];
  return locked.filter((c) => {
    const names = [c.name, ...(c.aliases ?? [])].map(norm).filter(Boolean);
    return names.some((nm) => wanted.some((w) => nm === w || nm.includes(w) || w.includes(nm)));
  });
}

// 鎖定 Location 嘅名係 extract_assets 砌出嚟嘅 `地點·時段`（text-handlers.ts:143），
// 但劇本原文／build_scenes 嘅 scene.location 唔會帶時段後綴。兩邊都剝走先可以比。
const stripTimeOfDay = (s: string) => s.replace(/[·・‧](?:早|日|黃昏|黄昏|夜)\s*$/u, "");
const baseName = (s: string) => norm(stripTimeOfDay(s));
// 單字地點（「屋」「山」）做 substring 會亂咬，只准整名相等
const MIN_FUZZY_LEN = 2;

// 揀呢個鏡頭要用邊個鎖定場景嘅參考圖。
// 優先用 build_scenes 寫入 DB 嘅 scene.location（權威來源），撞唔到先退回劇本原文 substring。
// 兩者都撞唔到 → 返 undefined（唔畀場景參考圖）。畀錯場景圖比冇場景圖差好多：
// 冇圖模型會照 prompt 文字描述畫，畀錯圖就會成個鏡頭畫咗喺第二個地方。
export function pickShotLocation(
  sceneText: string,
  locked: RefLocation[],
  sceneLocation?: string | null,
  ctx?: { episodeId?: string; sceneId?: string },
): RefLocation | undefined {
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
}

// Provider cap — normalizeReferenceImages (outbound-image.ts:12) silently
// splices beyond 6, so truncate HERE before the legend is numbered, or the
// 图片N legend and the actually-sent images drift out of sync. Characters,
// location and props all compete for these 6 slots — only assets actually
// matched to this shot (via matchShotCharacters/pickShotLocation/matchShotProps)
// are passed in, so busy shots degrade gracefully rather than overflowing.
export const MAX_SHOT_REFS = 6;

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
  shotProps: RefProp[] = [],
): RefAsset[] {
  const refAssets: RefAsset[] = [
    ...shotCharacters
      .filter((c) => c.lockedImageMediaId)
      .flatMap((c) => [
        { mediaId: c.lockedImageMediaId!, label: `${c.name}（角色全身正面）`, prompt: c.appearancePrompt },
        ...(c.faceImageMediaId ? [{ mediaId: c.faceImageMediaId, label: `${c.name}（面部特寫）`, prompt: "面部身份參照" }] : []),
        ...((c.views as LocationAngle[] | undefined) ?? [])
          .filter((v): v is LocationAngle & { mediaId: string } => v.mediaId != null)
          .map((v) => ({ mediaId: v.mediaId, label: `${c.name}（${v.label}）`, prompt: "同一角色的其他視角參照" })),
      ]),
    ...(shotLocation?.lockedImageMediaId
      ? [{ mediaId: shotLocation.lockedImageMediaId, label: `${shotLocation.name}（場景主視角）`, prompt: shotLocation.prompt ?? "" }]
      : []),
    ...((shotLocation?.angles as LocationAngle[] | undefined) ?? [])
      .filter((a): a is LocationAngle & { mediaId: string } => a.mediaId != null)
      .map((a) => ({
        mediaId: a.mediaId,
        label: `${shotLocation!.name}（場景視角：${a.label}）`,
        prompt: a.prompt,
      })),
    ...shotProps
      .filter((p) => p.lockedImageMediaId)
      .flatMap((p) => [
        { mediaId: p.lockedImageMediaId!, label: `${p.name}（道具主視角）`, prompt: p.prompt ?? "" },
        ...((p.views as LocationAngle[] | undefined) ?? [])
          .filter((v): v is LocationAngle & { mediaId: string } => v.mediaId != null)
          .map((v) => ({ mediaId: v.mediaId, label: `${p.name}（道具視角：${v.label}）`, prompt: v.prompt })),
      ]),
  ];
  return refAssets.slice(0, MAX_SHOT_REFS);
}
