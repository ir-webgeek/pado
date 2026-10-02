import { and, eq, sql } from "drizzle-orm";
import { customerWalletTx, customers, shops, walletTransactions, type DbOrTx } from "@shopino/db";
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

export type CustomerWalletReason = "refund" | "payment" | "adjust";

/** Atomic movement on a customer's store credit at one shop; debits fail (402) instead of going negative. */
export async function customerWalletMove(
  db: DbOrTx,
  shopId: string,
  customerId: string,
  amount: number,
  reason: CustomerWalletReason,
  ref?: { type: string; id: string },
  note?: string,
) {
  const [row] = await db
    .update(customers)
    .set({ walletBalance: sql`${customers.walletBalance} + ${amount}` })
    .where(and(eq(customers.id, customerId), eq(customers.shopId, shopId), amount < 0 ? sql`${customers.walletBalance} + ${amount} >= 0` : undefined))
    .returning({ balance: customers.walletBalance });
  if (!row) throw paymentRequired("customer_wallet_insufficient", "wallet balance is too low");
  await db.insert(customerWalletTx).values({ shopId, customerId, amount, balanceAfter: row.balance, reason, refType: ref?.type, refId: ref?.id, note });
  return row.balance;
}

export async function walletBalance(db: DbOrTx, shopId: string) {
  const s = await db.query.shops.findFirst({ where: eq(shops.id, shopId), columns: { walletBalance: true } });
  return s?.walletBalance ?? 0;
}
