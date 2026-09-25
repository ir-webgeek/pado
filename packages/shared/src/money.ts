/** All amounts are integers in Toman. Gateways that expect Rial get amount * 10 at the adapter boundary. */
export type Toman = number;

export function formatToman(amount: Toman, locale: "fa" | "en" = "fa"): string {
  const n = new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US").format(amount);
  return locale === "fa" ? `${n} تومان` : `${n} Toman`;
}

/** Short form used on cards: 1.3M, 699K. */
export function formatTomanShort(amount: Toman, locale: "fa" | "en" = "fa"): string {
  const fmt = (v: number) =>
    new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US", { maximumFractionDigits: 1 }).format(v);
  if (amount >= 1_000_000) return locale === "fa" ? `${fmt(amount / 1_000_000)} میلیون` : `${fmt(amount / 1_000_000)}M`;
  if (amount >= 1_000) return locale === "fa" ? `${fmt(amount / 1_000)} هزار` : `${fmt(amount / 1_000)}K`;
  return fmt(amount);
}

export function percentOf(amount: Toman, percent: number): Toman {
  return Math.round((amount * percent) / 100);
}

/** Loyalty points earned for a paid amount given "1 point per `perToman`". */
export function pointsFor(amount: Toman, perToman: number): number {
  if (perToman <= 0) return 0;
  return Math.floor(amount / perToman);
}
