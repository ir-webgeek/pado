import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { inventoryMovements, productVariants, products, stockReceiptItems, stockReceipts, type Database, type DbOrTx } from "@shopino/db";
import { receiptCode, weightedCost, type StockReceiptInput } from "@shopino/shared";
import { audit } from "../../lib/audit";
import { badRequest, notFound } from "../../lib/errors";

/**
 * Books a supplier delivery: stock goes up and each variant's cost becomes the weighted average of
 * what was on hand and what arrived. Variants are locked in id order, like order payment does.
 */
export async function createReceipt(db: Database, shopId: string, input: StockReceiptInput, actorId: string) {
  return db.transaction(async (tx) => {
    const ids = input.items.map((i) => i.variantId);
    const rows = await tx
      .select()
      .from(productVariants)
      .where(and(eq(productVariants.shopId, shopId), inArray(productVariants.id, ids)))
      .orderBy(productVariants.id)
      .for("update");
    if (rows.length !== ids.length) throw badRequest("invalid_variant", "a variant does not belong to this shop");
    const byId = new Map(rows.map((r) => [r.id, r]));
    const total = input.items.reduce((s, i) => s + i.quantity * i.unitCost, 0);

    const [receipt] = await tx
      .insert(stockReceipts)
      .values({ shopId, code: receiptCode(), supplier: input.supplier, note: input.note, receivedAt: input.receivedAt ?? new Date(), total, createdBy: actorId })
      .returning();
    await tx.insert(stockReceiptItems).values(input.items.map((i) => ({ receiptId: receipt!.id, ...i })));

    for (const it of input.items) {
      const v = byId.get(it.variantId)!;
      const [u] = await tx
        .update(productVariants)
        .set({ stock: sql`${productVariants.stock} + ${it.quantity}`, costPrice: weightedCost(v.stock, v.costPrice, it.quantity, it.unitCost) })
        .where(eq(productVariants.id, v.id))
        .returning({ stock: productVariants.stock });
      await tx.insert(inventoryMovements).values({
        shopId,
        variantId: v.id,
        delta: it.quantity,
        stockAfter: u!.stock,
        reason: "purchase",
        refType: "receipt",
        refId: receipt!.id,
        actorId,
      });
    }
    await audit(tx, shopId, { type: "user", id: actorId }, "inventory.receipt", "stock_receipt", receipt!.id, { total, items: input.items.length });
    return receipt!;
  });
}

const variantLabel = (attributes: unknown) => Object.values((attributes ?? {}) as Record<string, string>).join(" / ");

export async function receiptDetail(db: DbOrTx, shopId: string, id: string) {
  const r = await db.query.stockReceipts.findFirst({ where: and(eq(stockReceipts.id, id), eq(stockReceipts.shopId, shopId)) });
  if (!r) throw notFound("receipt");
  const items = await db
    .select({ id: stockReceiptItems.id, quantity: stockReceiptItems.quantity, unitCost: stockReceiptItems.unitCost, title: products.title, sku: productVariants.sku, attributes: productVariants.attributes })
    .from(stockReceiptItems)
    .innerJoin(productVariants, eq(productVariants.id, stockReceiptItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(stockReceiptItems.receiptId, r.id));
  return { ...r, items: items.map(({ attributes, ...i }) => ({ ...i, variantLabel: variantLabel(attributes) })) };
}

export async function listReceipts(db: DbOrTx, shopId: string) {
  return db
    .select({
      id: stockReceipts.id,
      code: stockReceipts.code,
      supplier: stockReceipts.supplier,
      receivedAt: stockReceipts.receivedAt,
      total: stockReceipts.total,
      lines: sql<number>`(select count(*)::int from ${stockReceiptItems} where ${stockReceiptItems.receiptId} = ${stockReceipts.id})`,
    })
    .from(stockReceipts)
    .where(eq(stockReceipts.shopId, shopId))
    .orderBy(desc(stockReceipts.receivedAt))
    .limit(200);
}

/** Every variant with stock, cost and on-hand value (stock x average cost). */
export async function stockValuation(db: DbOrTx, shopId: string) {
  const rows = await db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      title: products.title,
      sku: productVariants.sku,
      attributes: productVariants.attributes,
      price: productVariants.price,
      costPrice: productVariants.costPrice,
      stock: productVariants.stock,
      reserved: productVariants.reserved,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(eq(productVariants.shopId, shopId), sql`${products.status} <> 'archived'`))
    .orderBy(products.title, productVariants.position)
    .limit(1000);
  const items = rows.map(({ attributes, ...r }) => ({ ...r, variantLabel: variantLabel(attributes), value: r.costPrice === null ? null : r.costPrice * r.stock }));
  return {
    items,
    totalValue: items.reduce((s, i) => s + (i.value ?? 0), 0),
    retailValue: items.reduce((s, i) => s + i.price * i.stock, 0),
    missingCost: items.filter((i) => i.costPrice === null && i.stock > 0).length,
  };
}

export async function setCost(db: DbOrTx, shopId: string, variantId: string, costPrice: number | null) {
  const [row] = await db
    .update(productVariants)
    .set({ costPrice })
    .where(and(eq(productVariants.id, variantId), eq(productVariants.shopId, shopId)))
    .returning({ id: productVariants.id });
  if (!row) throw notFound("variant");
}
