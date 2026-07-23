
export const COST_CONFIRM_USD = 0.5;
export const COST_CONFIRM_UNITS = 5;

export function needsCostConfirm({ usd, units }: { usd?: number | null; units?: number | null }): boolean {
  if (typeof usd === "number" && usd >= COST_CONFIRM_USD) return true;
  if (typeof units === "number" && units > COST_CONFIRM_UNITS) return true;
  return false;
}

export function formatUsd(usd: number): string {
  return `~US$${usd.toFixed(2)}`;
}
