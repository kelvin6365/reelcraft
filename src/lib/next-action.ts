
export type StageKey = "input" | "assets" | "script" | "storyboard" | "images" | "videos" | "voice" | "export";

export interface EpisodeSnapshot {
  hasRawText: boolean;
  hasScript: boolean;
  characters: { total: number; locked: number; withCandidates: number };
  locations: { total: number; locked: number; withCandidates: number };
  scenes: number;
  shots: { total: number; withImage: number; withVideo: number };
  storyboardConfirmed: boolean;
  isSrtMode: boolean;
  voiceLines: { total: number; withAudio: number };
  // 配音表：有幾多把聲要派、派咗幾多。未派晒就唔准開 TTS —— 未派音嘅行會
  // 跌返 provider 預設聲，成集所有人同一把。
  voiceCast: { total: number; assigned: number };
  hasExport: boolean;
  runningTaskTypes: string[];
  failedTasks: number;
}

export interface NextAction {
  stage: StageKey;
  label: string;
  endpoint: string | null;
  blockedBy: string[];
  busy: boolean;
}

export type StageStatus =
  | "done"
  | "review"
  | "blocked"
  | "todo";

export interface StageState {
  key: StageKey;
  done: boolean;
  count?: { done: number; total: number };
  status: StageStatus;
  blockedBy: string[];
}

export function computeStages(s: EpisodeSnapshot): StageState[] {
  const assetsTotal = s.characters.total + s.locations.total;
  const assetsLocked = s.characters.locked + s.locations.locked;
  const assetsReady = assetsTotal > 0 && assetsLocked === assetsTotal;
  const scriptReady = s.isSrtMode ? s.hasRawText : s.hasScript;

  const stage = (
    key: StageKey,
    done: boolean,
    opts: { count?: { done: number; total: number }; blockedBy?: string[]; review?: boolean } = {},
  ): StageState => {
    const blockedBy = done ? [] : (opts.blockedBy ?? []);
    const status: StageStatus = done ? "done" : blockedBy.length > 0 ? "blocked" : opts.review ? "review" : "todo";
    return { key, done, count: opts.count, status, blockedBy };
  };

  return [
    stage("input", s.hasRawText, { blockedBy: s.hasRawText ? [] : ["貼上小說原文"] }),
    stage("script", scriptReady, { blockedBy: s.hasRawText ? [] : ["第 1 站：貼上小說原文"] }),
    stage("assets", assetsReady, {
      count: { done: assetsLocked, total: assetsTotal },
      blockedBy: scriptReady ? [] : ["第 2 站：先生成劇本"],
      review: assetsTotal > 0 && assetsLocked < assetsTotal,
    }),
    stage("storyboard", s.shots.total > 0 && s.storyboardConfirmed, {
      count: s.shots.total > 0 ? { done: 1, total: 1 } : undefined,
      blockedBy: assetsReady ? [] : ["第 3 站：鎖定所有角色與場景"],
      review: s.shots.total > 0 && !s.storyboardConfirmed,
    }),
    stage("images", s.shots.total > 0 && s.shots.withImage === s.shots.total, {
      count: { done: s.shots.withImage, total: s.shots.total },
      blockedBy: s.storyboardConfirmed && s.shots.total > 0 ? [] : ["第 4 站：確認分鏡表"],
    }),
    stage("videos", s.shots.total > 0 && s.shots.withVideo === s.shots.total, {
      count: { done: s.shots.withVideo, total: s.shots.total },
      blockedBy: s.shots.withImage > 0 ? [] : ["第 5 站：至少生成一張分鏡圖"],
    }),
    stage("voice", s.voiceLines.total > 0 && s.voiceLines.withAudio === s.voiceLines.total, {
      count: { done: s.voiceLines.withAudio, total: s.voiceLines.total },
      blockedBy: s.shots.total > 0 ? [] : ["第 4 站：先生成分鏡"],
      // 未派晒音色 = 等緊人揀嘢，唔係等緊機器跑
      review: s.voiceLines.total > 0 && s.voiceCast.assigned < s.voiceCast.total,
    }),
    stage("export", s.hasExport, {
      blockedBy: s.shots.withVideo > 0 ? [] : ["第 6 站：至少生成一段鏡頭視頻"],
    }),
  ];
}

const running = (s: EpisodeSnapshot, ...types: string[]) => types.some((t) => s.runningTaskTypes.includes(t));

export function computeNextAction(s: EpisodeSnapshot, episodeId: string): NextAction {
  const ep = (p: string) => `/api/episodes/${episodeId}/${p}`;

  if (!s.hasRawText) {
    return { stage: "input", label: "貼上小說原文", endpoint: null, blockedBy: [], busy: false };
  }
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
  const uncast = s.voiceCast.total - s.voiceCast.assigned;
  if (uncast > 0) {
    // 派音係揀嘢，唔係跑任務 —— endpoint null，用戶喺配音站逐個揀（或者撳 AI 派音）。
    return { stage: "voice", label: `派音（餘 ${uncast} 把聲未揀音色）`, endpoint: null, blockedBy: [], busy: false };
  }
  if (s.voiceLines.withAudio < s.voiceLines.total) {
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
