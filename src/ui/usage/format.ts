// Display formatters shared across usage components. Keep pure.

export function usd(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function int(n: number): string {
  return n.toLocaleString("en-US");
}

export function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

export function ms(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.round(n)}ms`;
}

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// CSV cell escaping per RFC 4180: quote when the value contains a comma,
// quote, or newline; double up any embedded quotes.
function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
  return lines.join("\r\n");
}

// Client-side CSV download. UTF-8 BOM prefix so Excel opens 繁體中文 correctly
// instead of mangling it as another codepage.
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
