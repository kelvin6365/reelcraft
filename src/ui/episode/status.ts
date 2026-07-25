
const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  assets: "資產階段",
  script: "劇本階段",
  storyboard: "分鏡階段",
  images: "圖像階段",
  videos: "視頻階段",
  export: "合成中",
  done: "已完成",
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

export function statusVariant(status: string): "default" | "outline" {
  return status === "done" ? "default" : "outline";
}

// 進度站序：對應 episode.status 喺流水線入面行到邊個站，用嚟畫進度條 / 排序。
export const STATUS_STATION_INDEX: Record<string, number> = {
  draft: 1,
  script: 2,
  assets: 3,
  storyboard: 4,
  images: 5,
  videos: 6,
  export: 7,
  done: 8,
};

export function stationIndexOf(status: string): number {
  return STATUS_STATION_INDEX[status] ?? 1;
}

const CONTINUE_LABEL: Record<string, string> = {
  draft: "啱啱開波 — 下一步生成劇本",
  script: "劇本生成緊 — 等埋佢完成",
  assets: "出緊資產 — 等埋角色/場景素材",
  storyboard: "卡喺分鏡檢查點 — 等你確認分鏡表",
  images: "出緊圖 / 等你生成鏡頭圖",
  videos: "出緊片 / 等你生成鏡頭片段",
  export: "合成緊 — 等埋成片輸出",
  done: "已出片 🎬",
};

export function continueLabel(status: string): string {
  return CONTINUE_LABEL[status] ?? "進行中";
}
