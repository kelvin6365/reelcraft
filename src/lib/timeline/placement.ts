// 單一嘅 chip 擺位邏輯 —— worker compose 同瀏覽器預覽時間軸都必須用呢個 module，
// 唔准各自重新實作，否則預覽同成片會唔一致。Pure，零 import，isomorphic。
//
// offsetMs 語義：null = auto（跟 lineIndex 順序、貼住上一句尾，即 legacy concat 行為）；
// 數字 = 用戶拖 chip 釘死嘅位置（相對鏡頭開頭，ms）。

export interface PlacedLine {
  lineId: string;
  startMs: number;
  endMs: number;
  // 非 null = 呢句音超出鏡頭長度，合成時會喺呢個時間點被截斷
  truncatedAtMs: number | null;
}

// 凍幀補時上限：最多補到 clip 原長 2 倍、或 +6 秒（取小）。超過上限嘅音照截——
// 唔封頂嘅話長對白會凍格十幾秒，成片好假。
export function padClip(clipMs: number, neededMs: number): { paddedMs: number; padMs: number } {
  const cap = Math.max(clipMs, Math.min(clipMs * 2, clipMs + 6000));
  const paddedMs = Math.min(Math.max(neededMs, clipMs), cap); // 永不縮短
  return { paddedMs, padMs: paddedMs - clipMs };
}

export interface PaddedPlacement {
  placed: PlacedLine[];
  clipMs: number;
  paddedMs: number;
  padMs: number;
}

// 擺位 + 凍幀補時一體：worker 合成同瀏覽器預覽都必須行呢個，唔准自己拼 padClip。
// 唔使 fixpoint：placeLines 只用 shotDurationMs 計 truncatedAtMs，位置只依賴
// offsetMs／lineIndex／音長——neededMs 第一 pass 已經係終值，第二次 placeLines
// 純粹對 paddedMs 刷新截斷 flags。
export function placeLinesPadded(
  lines: { id: string; lineIndex: number; offsetMs: number | null; audioDurationMs: number }[],
  clipMs: number,
): PaddedPlacement {
  const first = placeLines(lines, clipMs);
  const neededMs = first.reduce((m, p) => Math.max(m, p.endMs), 0);
  const { paddedMs, padMs } = padClip(clipMs, neededMs);
  const placed = padMs > 0 ? placeLines(lines, paddedMs) : first;
  return { placed, clipMs, paddedMs, padMs };
}

export function placeLines(
  lines: { id: string; lineIndex: number; offsetMs: number | null; audioDurationMs: number }[],
  shotDurationMs: number,
): PlacedLine[] {
  const sorted = [...lines].sort((a, b) => a.lineIndex - b.lineIndex);
  let cursor = 0;
  const result: PlacedLine[] = [];
  for (const line of sorted) {
    const start = line.offsetMs ?? cursor;
    const end = start + line.audioDurationMs;
    cursor = Math.max(cursor, end);
    result.push({
      lineId: line.id,
      startMs: start,
      endMs: end,
      truncatedAtMs: end > shotDurationMs ? shotDurationMs : null,
    });
  }
  return result;
}
