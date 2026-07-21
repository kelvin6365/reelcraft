// Pure, fs-free line-level diff (LCS-based) for the three-pane prompt diff
// (Slice 5: project layer + drift). No new dependency — small enough to own.
export interface DiffLine {
  type: "same" | "add" | "del";
  text: string;
}

// Classic O(n*m) LCS table, then backtrack to a same/add/del line sequence.
// Prompt templates are at most a few hundred lines, so this is plenty fast.
export function diffLines(a: string, b: string): DiffLine[] {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const n = aLines.length;
  const m = bLines.length;

  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        aLines[i] === bLines[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      result.push({ type: "same", text: aLines[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ type: "del", text: aLines[i] });
      i++;
    } else {
      result.push({ type: "add", text: bLines[j] });
      j++;
    }
  }
  while (i < n) {
    result.push({ type: "del", text: aLines[i] });
    i++;
  }
  while (j < m) {
    result.push({ type: "add", text: bLines[j] });
    j++;
  }
  return result;
}
