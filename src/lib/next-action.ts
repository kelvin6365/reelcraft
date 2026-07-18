// Next Best Action — the server-computed "one thing to do now" that powers the
// always-visible card and stage unlocking (docs/tech/05-api-routes.md).
// Pure function over an episode snapshot; fully unit-tested.

export type StageKey = "input" | "assets" | "script" | "storyboard" | "images" | "videos" | "voice" | "export";

export interface EpisodeSnapshot {
  hasRawText: boolean;
  hasScript: boolean;
  characters: { total: number; locked: number; withCandidates: number };
  locations: { total: number; locked: number; withCandidates: number };
  scenes: number;
  shots: { total: number; withImage: number; withVideo: number };
  storyboardConfirmed: boolean;
  isSrtMode: boolean; // project.inputType === 'srt' — deterministic subtitle pipeline
  voiceLines: { total: number; withAudio: number };
  hasExport: boolean;
  runningTaskTypes: string[]; // active tasks for this episode
  failedTasks: number;
}

export interface NextAction {
  stage: StageKey;
  label: string; // 繁中, shown on the card
  endpoint: string | null; // POST target; null = user action in UI (e.g. review/lock)
  blockedBy: string[]; // human-readable missing prerequisites
  busy: boolean; // a related task is already running
}

export interface StageState {
  key: StageKey;
  done: boolean;
  count?: { done: number; total: number };
}

export function computeStages(s: EpisodeSnapshot): StageState[] {
  const assetsTotal = s.characters.total + s.locations.total;
  const assetsLocked = s.characters.locked + s.locations.locked;
  return [
    { key: "input", done: s.hasRawText },
    { key: "assets", done: assetsTotal > 0 && assetsLocked === assetsTotal, count: { done: assetsLocked, total: assetsTotal } },
    { key: "script", done: s.hasScript },
    { key: "storyboard", done: s.shots.total > 0 && s.storyboardConfirmed, count: { done: s.shots.total > 0 ? 1 : 0, total: 1 } },
    { key: "images", done: s.shots.total > 0 && s.shots.withImage === s.shots.total, count: { done: s.shots.withImage, total: s.shots.total } },
    { key: "videos", done: s.shots.total > 0 && s.shots.withVideo === s.shots.total, count: { done: s.shots.withVideo, total: s.shots.total } },
    { key: "voice", done: s.voiceLines.total > 0 && s.voiceLines.withAudio === s.voiceLines.total, count: { done: s.voiceLines.withAudio, total: s.voiceLines.total } },
    { key: "export", done: s.hasExport },
  ];
}

const running = (s: EpisodeSnapshot, ...types: string[]) => types.some((t) => s.runningTaskTypes.includes(t));

export function computeNextAction(s: EpisodeSnapshot, episodeId: string): NextAction {
  const ep = (p: string) => `/api/episodes/${episodeId}/${p}`;

  if (!s.hasRawText) {
    return { stage: "input", label: "貼上小說原文", endpoint: null, blockedBy: [], busy: false };
  }
  // SRT mode has no script/storyboard-generation stages: subtitle cues build the
  // structure deterministically (see the storyboard branch below). Skip the script gate.
  if (!s.isSrtMode && !s.hasScript) {
    return { stage: "script", label: "生成劇本", endpoint: ep("rewrite-script"), blockedBy: [], busy: running(s, "REWRITE_SCRIPT") };
  }
  const assetsTotal = s.characters.total + s.locations.total;
  if (assetsTotal === 0) {
    return { stage: "assets", label: "抽取角色與場景", endpoint: ep("extract-assets"), blockedBy: [], busy: running(s, "EXTRACT_ASSETS") };
  }
  const noCandidates = s.characters.total - s.characters.withCandidates + (s.locations.total - s.locations.withCandidates);
  if (noCandidates > 0) {
    return {
      stage: "assets",
      label: `生成資產圖（餘 ${noCandidates} 個）`,
      endpoint: ep("generate-asset-images"),
      blockedBy: [],
      busy: running(s, "IMAGE_CHARACTER", "IMAGE_LOCATION"),
    };
  }
  const unlocked = assetsTotal - (s.characters.locked + s.locations.locked);
  if (unlocked > 0) {
    return { stage: "assets", label: `鎖定資產（餘 ${unlocked} 個要揀圖）`, endpoint: null, blockedBy: [], busy: false };
  }
  if (s.scenes === 0 || s.shots.total === 0) {
    if (s.isSrtMode) {
      return { stage: "storyboard", label: "解析 SRT 建分鏡", endpoint: ep("srt-build"), blockedBy: [], busy: running(s, "SRT_BUILD") };
    }
    return { stage: "storyboard", label: "生成分鏡", endpoint: ep("storyboard"), blockedBy: [], busy: running(s, "BUILD_SCENES", "STORYBOARD_RUN") };
  }
  if (!s.storyboardConfirmed) {
    return { stage: "storyboard", label: "審核並確認分鏡表", endpoint: null, blockedBy: [], busy: false };
  }
  if (s.shots.withImage < s.shots.total) {
    return {
      stage: "images",
      label: `生成分鏡圖（${s.shots.withImage}/${s.shots.total}）`,
      endpoint: ep("generate-shot-images"),
      blockedBy: [],
      busy: running(s, "IMAGE_SHOT"),
    };
  }
  if (s.shots.withVideo < s.shots.total) {
    return {
      stage: "videos",
      label: `生成鏡頭視頻（${s.shots.withVideo}/${s.shots.total}）`,
      endpoint: ep("generate-shot-videos"),
      blockedBy: [],
      busy: running(s, "VIDEO_SHOT"),
    };
  }
  if (s.voiceLines.total === 0) {
    return { stage: "voice", label: "分析台詞並配音", endpoint: ep("voice"), blockedBy: [], busy: running(s, "VOICE_ANALYZE") };
  }
  if (s.voiceLines.withAudio < s.voiceLines.total) {
    // SRT mode creates the voice lines up front (SRT_BUILD), so there is no
    // VOICE_ANALYZE step that fans out TTS — the user triggers it via tts-all.
    if (s.isSrtMode) {
      return {
        stage: "voice",
        label: `配音（${s.voiceLines.withAudio}/${s.voiceLines.total}）`,
        endpoint: ep("tts-all"),
        blockedBy: [],
        busy: running(s, "TTS_LINE"),
      };
    }
    return {
      stage: "voice",
      label: `配音中（${s.voiceLines.withAudio}/${s.voiceLines.total}）`,
      endpoint: null,
      blockedBy: [],
      busy: running(s, "TTS_LINE") || s.voiceLines.withAudio < s.voiceLines.total,
    };
  }
  if (!s.hasExport) {
    return { stage: "export", label: "合成整集並導出", endpoint: ep("compose"), blockedBy: [], busy: running(s, "COMPOSE_EPISODE") };
  }
  return { stage: "export", label: "已完成 🎬 可下載成片", endpoint: null, blockedBy: [], busy: false };
}
