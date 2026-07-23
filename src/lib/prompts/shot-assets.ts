
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
