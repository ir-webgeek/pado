import { and, eq, sql } from "drizzle-orm";
import { shops, walletTransactions, type DbOrTx } from "@shopino/db";
import type { WalletTxKind } from "@shopino/shared";
import { paymentRequired } from "../../lib/errors";

/** Atomic wallet movement; debits fail (402) instead of going negative. */
export async function walletMove(
  db: DbOrTx,
  shopId: string,
  kind: WalletTxKind,
  amount: number,
  ref?: { type: string; id: string },
  meta?: Record<string, unknown>,
) {
  const [row] = await db
    .update(shops)
    .set({ walletBalance: sql`${shops.walletBalance} + ${amount}` })
    .where(and(eq(shops.id, shopId), amount < 0 ? sql`${shops.walletBalance} + ${amount} >= 0` : undefined))
    .returning({ balance: shops.walletBalance });
  if (!row) throw paymentRequired("wallet_insufficient", "wallet balance is too low - top up to continue");
  await db.insert(walletTransactions).values({ shopId, kind, amount, balanceAfter: row.balance, refType: ref?.type, refId: ref?.id, meta: meta ?? null });
  return row.balance;
}

export async function walletBalance(db: DbOrTx, shopId: string) {
  const s = await db.query.shops.findFirst({ where: eq(shops.id, shopId), columns: { walletBalance: true } });
  return s?.walletBalance ?? 0;
}
