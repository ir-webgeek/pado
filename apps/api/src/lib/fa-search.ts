import { sql, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { FA_FOLD_FROM as FROM, FA_FOLD_TO as TO } from "@shopino/shared";

/**
 * Persian-aware text matching. Iranian users type with Persian or Arabic keyboards (ي/ك vs ی/ک), with or
 * without the zero-width non-joiner, and with Persian, Arabic or Latin digits; the stored text varies the
 * same way. Both sides are folded to one form before comparing.
 */
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

/**
 * SQL expression of a column folded the same way. The constants are inlined (not bound parameters) so
 * the planner matches the trigram expression indexes on products.title and customers.name.
 */
export const faFold = (col: AnyColumn | SQL) => sql`lower(translate(${col}, ${sql.raw(`'${FROM}'`)}, ${sql.raw(`'${TO}'`)}))`;

/** `col` contains `q`, ignoring keyboard and digit differences. */
export const faContains = (col: AnyColumn | SQL, q: string) => sql`${faFold(col)} LIKE ${"%" + faNormalize(q).replace(/[%_\\]/g, (c) => "\\" + c) + "%"}`;
