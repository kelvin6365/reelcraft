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
