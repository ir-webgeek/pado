import { and, eq, sql } from "drizzle-orm";
import { discounts, type DbOrTx } from "@shopino/db";
import { percentOf } from "@shopino/shared";
import { badRequest } from "../../lib/errors";

export async function evaluateDiscount(db: DbOrTx, shopId: string, code: string, amount: number, scope: "orders" | "appointments") {
  const d = await db.query.discounts.findFirst({ where: and(eq(discounts.shopId, shopId), eq(discounts.code, code.toUpperCase())) });
  const now = new Date();
  if (!d || !d.active) throw badRequest("discount_invalid", "discount code is not valid");
  if (d.appliesTo !== "all" && d.appliesTo !== scope) throw badRequest("discount_scope", "code does not apply here");
  if (d.startsAt && d.startsAt > now) throw badRequest("discount_not_started");
  if (d.endsAt && d.endsAt < now) throw badRequest("discount_expired", "discount code has expired");
  if (d.maxUses !== null && d.usedCount >= d.maxUses) throw badRequest("discount_used_up");
  if (amount < d.minOrder) throw badRequest("discount_min_order", `minimum amount is ${d.minOrder}`);
  const value = d.type === "percent" ? percentOf(amount, Math.min(d.value, 100)) : Math.min(d.value, amount);
  return { discount: d, amount: value };
}

/** Consume one use at payment time; the WHERE clause keeps maxUses safe under concurrency. */
export async function consumeDiscount(db: DbOrTx, shopId: string, code: string) {
  await db
    .update(discounts)
    .set({ usedCount: sql`${discounts.usedCount} + 1` })
    .where(
      and(
        eq(discounts.shopId, shopId),
        eq(discounts.code, code),
        sql`(${discounts.maxUses} IS NULL OR ${discounts.usedCount} < ${discounts.maxUses})`,
      ),
    );
}
