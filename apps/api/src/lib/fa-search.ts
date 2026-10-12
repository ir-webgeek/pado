import { sql, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";

/**
 * Persian-aware text matching. Iranian users type with Persian or Arabic keyboards (ي/ك vs ی/ک), with or
 * without the zero-width non-joiner, and with Persian, Arabic or Latin digits; the stored text varies the
 * same way. Both sides are folded to one form before comparing.
 */
const FROM = "يىكۀ‌‍۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩";
const TO = "ییکه  01234567890123456789";

/** Same folding as `faFold` in SQL, for the search words. */
export function faNormalize(s: string): string {
  let out = "";
  for (const ch of s) {
    const i = FROM.indexOf(ch);
    out += i >= 0 ? TO[i] : ch;
  }
  return out
    .replace(/[ً-ٰٟ]/g, "") // harakat
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** SQL expression of a column folded the same way (immutable, so it can back a trigram index). */
export const faFold = (col: AnyColumn | SQL) => sql`lower(translate(${col}, ${FROM}, ${TO}))`;

/** `col` contains `q`, ignoring keyboard and digit differences. */
export const faContains = (col: AnyColumn | SQL, q: string) => sql`${faFold(col)} LIKE ${"%" + faNormalize(q).replace(/[%_\\]/g, (c) => "\\" + c) + "%"}`;
