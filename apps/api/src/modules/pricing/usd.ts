/** Toman price from a USD price (cents), the shop's rate, markup and rounding step. Always rounds up. */
export function tomanFromUsd(priceUsdCents: number, rate: number, markupPercent: number, roundTo: number): number {
  const raw = (priceUsdCents / 100) * rate * (1 + markupPercent / 100);
  const step = Math.max(1, roundTo);
  return Math.ceil(raw / step) * step;
}

/** Read a number from JSON by a dot path, e.g. "data.usd.sell". */
export function readPath(json: unknown, path: string): number | null {
  let cur: unknown = json;
  for (const key of path.split(".").filter(Boolean)) {
    if (cur && typeof cur === "object" && key in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[key];
    else return null;
  }
  const n = typeof cur === "string" ? Number(cur.replace(/[,\s]/g, "")) : typeof cur === "number" ? cur : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}
