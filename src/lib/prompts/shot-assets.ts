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

const norm = (s: string) => s.normalize("NFKC").trim().toLowerCase();

export function matchShotCharacters(shotCharNames: string[], locked: RefCharacter[]): RefCharacter[] {
  const wanted = shotCharNames.map(norm).filter(Boolean);
  if (!wanted.length) return [];
  return locked.filter((c) => {
    const names = [c.name, ...(c.aliases ?? [])].map(norm).filter(Boolean);
    return names.some((nm) => wanted.some((w) => nm === w || nm.includes(w) || w.includes(nm)));
  });
}

export function pickShotLocation(sceneText: string, locked: RefLocation[]): RefLocation | undefined {
  if (locked.length <= 1) return locked[0];
  const hay = norm(sceneText);
  return locked.find((l) => l.name.trim() !== "" && hay.includes(norm(l.name))) ?? locked[0];
}

export interface RefAsset {
  mediaId: string;
  label: string;
  prompt: string;
}

// Provider cap — normalizeReferenceImages (outbound-image.ts:12) silently
// splices beyond 6, so truncate HERE before the legend is numbered, or the
// 图片N legend and the actually-sent images drift out of sync.
export const MAX_SHOT_REFS = 6;

export function buildShotRefAssets(
  shotCharacters: {
    name: string;
    appearancePrompt: string;
    lockedImageMediaId: string | null;
    faceImageMediaId: string | null;
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
): RefAsset[] {
  const refAssets: RefAsset[] = [
    ...shotCharacters
      .filter((c) => c.lockedImageMediaId)
      .flatMap((c) => [
        { mediaId: c.lockedImageMediaId!, label: `${c.name}（角色全身多視角）`, prompt: c.appearancePrompt },
        ...(c.faceImageMediaId ? [{ mediaId: c.faceImageMediaId, label: `${c.name}（面部特寫）`, prompt: "面部身份參照" }] : []),
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
  ];
  return refAssets.slice(0, MAX_SHOT_REFS);
}
