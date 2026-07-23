export function mergeNegatives(...sources: (string | string[] | undefined)[]): string {
  const terms = sources
    .flatMap((s) => (Array.isArray(s) ? s : (s ?? "").split(",")))
    .map((t) => t.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of terms) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.join(", ");
}
