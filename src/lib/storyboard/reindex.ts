// After a shot is deleted the remaining shots must stay a contiguous 1..N run —
// 火豹 #19「鏡頭唔支援刪除」/ Toonflow #119「插入一行之後下面編號都要自己手動改」.
// Pure so it can be unit-tested; the route runs the result in a transaction.
//
// Returns only the shots whose index actually changes, in ASCENDING target
// order. That order matters: shotIndex is unique per episode, so renumbering
// 5→4, 6→5 must happen low-to-high or an update would momentarily collide with a
// row that has not moved yet.

export interface IndexedShot {
  id: string;
  shotIndex: number;
}

export function planReindex(remaining: IndexedShot[]): { id: string; shotIndex: number }[] {
  const ordered = [...remaining].sort((a, b) => a.shotIndex - b.shotIndex);
  const moves: { id: string; shotIndex: number }[] = [];
  ordered.forEach((shot, i) => {
    const target = i + 1;
    if (shot.shotIndex !== target) moves.push({ id: shot.id, shotIndex: target });
  });
  return moves;
}
