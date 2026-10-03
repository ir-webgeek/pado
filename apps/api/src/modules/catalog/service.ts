import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { categories, inventoryMovements, productVariants, products, resolveShopSettings, shops, type DbOrTx } from "@shopino/db";
import { tomanFromUsd } from "../pricing/usd";
import { PLANS, type ProductInput } from "@shopino/shared";
import type { ShopCtx } from "../../lib/auth";
import { badRequest, notFound, paymentRequired } from "../../lib/errors";

export function slugify(input: string) {
  const s = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  // Persian titles produce non-latin slugs; fall back to a short random slug for URL safety
  return /^[a-z0-9-]+$/.test(s) && s.length >= 3 ? s : `p-${Math.random().toString(36).slice(2, 10)}`;
}

export async function listProducts(db: DbOrTx, shopId: string, opts: { q?: string; status?: string; categoryId?: string; limit: number; offset: number }) {
  const where = [eq(products.shopId, shopId)];
  if (opts.status) where.push(eq(products.status, opts.status as "active"));
  if (opts.categoryId) where.push(eq(products.categoryId, opts.categoryId));
  if (opts.q) where.push(sql`${products.title} ILIKE ${"%" + opts.q + "%"}`);
  const rows = await db.query.products.findMany({
    where: and(...where),
    orderBy: (p, { desc }) => [desc(p.createdAt)],
    limit: opts.limit,
    offset: opts.offset,
  });
  const ids = rows.map((r) => r.id);
  const variants = ids.length ? await db.select().from(productVariants).where(inArray(productVariants.productId, ids)) : [];
  return rows.map((p) => ({
    ...p,
    variants: variants.filter((v) => v.productId === p.id).sort((a, b) => a.position - b.position),
  }));
}

export async function getProduct(db: DbOrTx, shopId: string, productId: string) {
  const p = await db.query.products.findFirst({ where: and(eq(products.id, productId), eq(products.shopId, shopId)) });
  if (!p) throw notFound("product");
  const variants = await db.select().from(productVariants).where(eq(productVariants.productId, p.id)).orderBy(productVariants.position);
  return { ...p, variants };
}

async function assertProductLimit(db: DbOrTx, shop: Pick<ShopCtx, "id" | "plan">) {
  const limit = PLANS[shop.plan].limits.products;
  if (limit === null) return;
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(products).where(eq(products.shopId, shop.id));
  if ((row?.n ?? 0) >= limit) throw paymentRequired("plan_limit_products", `your plan allows ${limit} products`);
}

export async function upsertProduct(db: DbOrTx, shop: Pick<ShopCtx, "id" | "plan">, input: ProductInput, actorId: string, productId?: string) {
  if (input.categoryId) {
    const cat = await db.query.categories.findFirst({ where: and(eq(categories.id, input.categoryId), eq(categories.shopId, shop.id)) });
    if (!cat) throw badRequest("invalid_category");
  }
  const values = {
    title: input.title,
    slug: input.slug ?? slugify(input.title),
    description: input.description,
    categoryId: input.categoryId ?? null,
    images: input.images,
    status: input.status,
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
  };

  let id = productId;
  if (id) {
    const [row] = await db
      .update(products)
      .set(values)
      .where(and(eq(products.id, id), eq(products.shopId, shop.id)))
      .returning({ id: products.id });
    if (!row) throw notFound("product");
  } else {
    await assertProductLimit(db, shop);
    const [row] = await db.insert(products).values({ ...values, shopId: shop.id }).returning({ id: products.id });
    id = row!.id;
  }

  // variants: update by id, insert new, delete removed (only if never sold - FK keeps order history via set null)
  const keepIds = input.variants.map((v) => v.id).filter((v): v is string => Boolean(v));
  await db
    .delete(productVariants)
    .where(and(eq(productVariants.productId, id), keepIds.length ? notInArray(productVariants.id, keepIds) : sql`true`));

  const shopRow = await db.query.shops.findFirst({ where: eq(shops.id, shop.id), columns: { settings: true } });
  const pricing = resolveShopSettings(shopRow?.settings).pricing;
  const usdOn = pricing.usdEnabled && pricing.usdRate > 0;

  for (const [position, v] of input.variants.entries()) {
    const data = {
      sku: v.sku || null,
      attributes: v.attributes,
      priceUsdCents: v.priceUsdCents ?? null,
      // USD-linked variants take their Toman price from the current rate
      price: usdOn && v.priceUsdCents ? tomanFromUsd(v.priceUsdCents, pricing.usdRate, pricing.markupPercent, pricing.roundTo) : v.price,
      compareAtPrice: v.compareAtPrice ?? null,
      lowStockThreshold: v.lowStockThreshold,
      position,
    };
    if (v.id) {
      const existing = await db.query.productVariants.findFirst({ where: and(eq(productVariants.id, v.id), eq(productVariants.productId, id)) });
      if (!existing) throw badRequest("invalid_variant", `variant ${v.id} does not belong to product`);
      await db.update(productVariants).set(data).where(eq(productVariants.id, v.id));
      if (v.stock !== existing.stock) {
        await adjustStock(db, shop.id, { variantId: v.id, delta: v.stock - existing.stock, reason: "correction" }, actorId);
      }
    } else {
      const [created] = await db.insert(productVariants).values({ ...data, shopId: shop.id, productId: id, stock: v.stock }).returning();
      if (v.stock > 0) {
        await db.insert(inventoryMovements).values({ shopId: shop.id, variantId: created!.id, delta: v.stock, stockAfter: v.stock, reason: "purchase", actorId });
      }
    }
  }
  return getProduct(db, shop.id, id);
}

/** Atomic stock change with an audit row. Never lets stock drop below what is reserved. */
export async function adjustStock(
  db: DbOrTx,
  shopId: string,
  input: { variantId: string; delta: number; reason: string; note?: string; refType?: string; refId?: string },
  actorId?: string,
) {
  const [row] = await db
    .update(productVariants)
    .set({ stock: sql`${productVariants.stock} + ${input.delta}` })
    .where(
      and(
        eq(productVariants.id, input.variantId),
        eq(productVariants.shopId, shopId),
        sql`${productVariants.stock} + ${input.delta} >= ${productVariants.reserved}`,
      ),
    )
    .returning({ stock: productVariants.stock });
  if (!row) throw badRequest("insufficient_stock", "stock cannot go below reserved quantity");
  await db.insert(inventoryMovements).values({
    shopId,
    variantId: input.variantId,
    delta: input.delta,
    stockAfter: row.stock,
    reason: input.reason,
    note: input.note,
    refType: input.refType,
    refId: input.refId,
    actorId,
  });
  return row.stock;
}

export async function lowStock(db: DbOrTx, shopId: string, limit = 20) {
  return db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      title: products.title,
      sku: productVariants.sku,
      attributes: productVariants.attributes,
      available: sql<number>`${productVariants.stock} - ${productVariants.reserved}`,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        eq(productVariants.shopId, shopId),
        eq(products.status, "active"),
        sql`${productVariants.stock} - ${productVariants.reserved} <= ${productVariants.lowStockThreshold}`,
      ),
    )
    .orderBy(sql`${productVariants.stock} - ${productVariants.reserved}`)
    .limit(limit);
}

export const variantLabel = (attrs: Record<string, string>) => Object.values(attrs).join(" / ");
