import { and, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";
import { shops, type Database } from "@shopino/db";
import { refreshToken } from "./oauth";

const DAY = 86_400_000;

/**
 * Refreshes long-lived Instagram tokens that expire within 10 days (Meta requires them to be >= 24h old).
 * Tokens with no known expiry (pasted manually, or connected before expiry was tracked) are tried too: a
 * successful refresh records the expiry and puts them on the normal schedule; a failure is logged and
 * retried on the next run.
 */
export async function refreshInstagramTokens(db: Database) {
  const due = await db
    .select({ id: shops.id, token: shops.igAccessToken })
    .from(shops)
    .where(
      and(
        isNotNull(shops.igAccessToken),
        or(isNull(shops.igTokenExpiresAt), and(gt(shops.igTokenExpiresAt, new Date()), lt(shops.igTokenExpiresAt, new Date(Date.now() + 10 * DAY)))),
      ),
    );
  let refreshed = 0;
  for (const s of due) {
    try {
      const r = await refreshToken(s.token!);
      await db.update(shops).set({ igAccessToken: r.access_token, igTokenExpiresAt: new Date(Date.now() + r.expires_in * 1000) }).where(eq(shops.id, s.id));
      refreshed++;
    } catch (err) {
      console.error(`[instagram] token refresh failed for shop ${s.id}:`, (err as Error).message);
    }
  }
  return { due: due.length, refreshed };
}
