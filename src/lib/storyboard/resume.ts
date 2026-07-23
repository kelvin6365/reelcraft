
export interface ResumableScene {
  id: string;
}

export interface ResumePlan<T extends ResumableScene> {
  toBuild: T[];
  keepSceneIds: string[];
  skipped: number;
}

export function planResume<T extends ResumableScene>(scenes: T[], doneSceneIds: string[]): ResumePlan<T> {
  const done = new Set(doneSceneIds);
  const keepSceneIds = scenes.filter((s) => done.has(s.id)).map((s) => s.id);
  const toBuild = scenes.filter((s) => !done.has(s.id));
  return { toBuild, keepSceneIds, skipped: keepSceneIds.length };
}
