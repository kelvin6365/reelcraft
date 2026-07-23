
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
