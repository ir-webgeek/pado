import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { orderItems, orders, productVariants, products, stockPools, type DbOrTx } from "@shopino/db";
import { badRequest, notFound } from "../../lib/errors";
import { variantLabel } from "../catalog/service";

/**
 * Lock the given variants and every variant sharing a stock pool with them, always in id order.
 * Stock writers call this first: the pool trigger then never waits on another transaction, so two
 * checkouts on different products of one pool cannot oversell or deadlock.
 */
export async function lockStock(tx: DbOrTx, shopId: string, variantIds: string[]) {
  if (!variantIds.length) return;
  const ids = sql`ARRAY[${sql.join(variantIds.map((id) => sql`${id}`), sql`, `)}]::uuid[]`;
  await tx.execute(sql`
    SELECT id FROM product_variants
    WHERE shop_id = ${shopId}
      AND (id = ANY(${ids})
        OR stock_pool_id IN (SELECT stock_pool_id FROM product_variants WHERE id = ANY(${ids}) AND stock_pool_id IS NOT NULL))
    ORDER BY id
    FOR UPDATE`);
}

export async function listPools(db: DbOrTx, shopId: string) {
  const pools = await db.select().from(stockPools).where(eq(stockPools.shopId, shopId)).orderBy(asc(stockPools.name));
  if (!pools.length) return [];
  const members = await db
    .select({
      poolId: productVariants.stockPoolId,
      variantId: productVariants.id,
      productId: products.id,
      title: products.title,
      attributes: productVariants.attributes,
      sku: productVariants.sku,
      stock: productVariants.stock,
      reserved: productVariants.reserved,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.stockPoolId, pools.map((p) => p.id)))
    .orderBy(products.title);
  return pools.map((p) => {
    const ms = members.filter((m) => m.poolId === p.id);
    return {
      ...p,
      stock: ms[0]?.stock ?? 0,
      reserved: ms[0]?.reserved ?? 0,
      members: ms.map(({ attributes, poolId: _p, ...m }) => ({ ...m, variantLabel: variantLabel(attributes) })),
    };
  });
}

async function shopVariants(tx: DbOrTx, shopId: string, ids: string[]) {
  const rows = await tx.select().from(productVariants).where(and(eq(productVariants.shopId, shopId), inArray(productVariants.id, ids)));
  if (rows.length !== new Set(ids).size) throw badRequest("invalid_variants", "some variants do not belong to this shop");
  return rows;
}

/**
 * New pool from variants that sell the same item. Stock starts at `stock` (default: the first variant's);
 * reservations of all members are added up, since each one holds a unit of the shared stock.
 */
export async function createPool(tx: DbOrTx, shopId: string, input: { name: string; variantIds: string[]; stock?: number }) {
  await lockStock(tx, shopId, input.variantIds);
  const rows = await shopVariants(tx, shopId, input.variantIds);
  if (rows.some((r) => r.stockPoolId)) throw badRequest("already_pooled", "a variant is already in a shared stock; remove it there first");
  const stock = input.stock ?? rows.find((r) => r.id === input.variantIds[0])!.stock;
  const reserved = rows.reduce((s, r) => s + r.reserved, 0);
  const [pool] = await tx.insert(stockPools).values({ shopId, name: input.name }).returning();
  // set numbers before joining so the trigger has nothing to copy yet
  await tx.update(productVariants).set({ stock, reserved, stockPoolId: pool!.id }).where(inArray(productVariants.id, input.variantIds));
  return pool!;
}

export async function addToPool(tx: DbOrTx, shopId: string, poolId: string, variantId: string) {
  const pool = await tx.query.stockPools.findFirst({ where: and(eq(stockPools.id, poolId), eq(stockPools.shopId, shopId)) });
  if (!pool) throw notFound("shared stock");
  const [member] = await tx.select().from(productVariants).where(eq(productVariants.stockPoolId, poolId)).limit(1);
  await lockStock(tx, shopId, [variantId, ...(member ? [member.id] : [])]);
  const [v] = await shopVariants(tx, shopId, [variantId]);
  if (v!.stockPoolId) throw badRequest("already_pooled", "this variant is already in a shared stock");
  const stock = member?.stock ?? v!.stock;
  const reserved = (member?.reserved ?? 0) + v!.reserved;
  await tx.update(productVariants).set({ stockPoolId: poolId }).where(eq(productVariants.id, variantId));
  // one write on a member updates everyone, the new variant included
  await tx.update(productVariants).set({ stock, reserved }).where(eq(productVariants.id, member?.id ?? variantId));
}

/** The variant leaves with its own copy of the stock. Not while unpaid orders hold some of it. */
export async function removeFromPool(tx: DbOrTx, shopId: string, variantId: string) {
  await lockStock(tx, shopId, [variantId]);
  const [open] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orderItems.variantId, variantId), eq(orders.status, "awaiting_payment")));
  if (open && open.n > 0) throw badRequest("has_reservations", "unpaid orders reserve this item; try again once they are paid or expire");
  const [row] = await tx
    .update(productVariants)
    .set({ stockPoolId: null, reserved: 0 })
    .where(and(eq(productVariants.id, variantId), eq(productVariants.shopId, shopId)))
    .returning({ id: productVariants.id });
  if (!row) throw notFound("variant");
}

export async function deletePool(tx: DbOrTx, shopId: string, poolId: string) {
  const [row] = await tx.delete(stockPools).where(and(eq(stockPools.id, poolId), eq(stockPools.shopId, shopId))).returning({ id: stockPools.id });
  if (!row) throw notFound("shared stock");
}
