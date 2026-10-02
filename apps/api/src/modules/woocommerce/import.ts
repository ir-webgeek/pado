import { and, eq } from "drizzle-orm";
import { categories, productVariants, products, shops, wooImports, type Database } from "@shopino/db";
import { slugify, upsertProduct } from "../catalog/service";
import { copyImage } from "../instagram/importer";
import { wooGet, type WooCreds } from "./client";
import { mapSimple, mapVariation, stripHtml, variantKey, type MappedVariant, type WooProduct, type WooUnit, type WooVariation } from "./map";

const PAGE = 50;
const MAX_ERRORS = 50;

async function categoryId(db: Database, shopId: string, name: string | undefined) {
  if (!name) return null;
  const found = await db.query.categories.findFirst({ where: and(eq(categories.shopId, shopId), eq(categories.name, name)) });
  if (found) return found.id;
  const [row] = await db
    .insert(categories)
    .values({ shopId, name: name.slice(0, 80), slug: slugify(name) })
    .onConflictDoNothing()
    .returning({ id: categories.id });
  return row?.id ?? null;
}

async function variationsOf(c: WooCreds, p: WooProduct) {
  const out: WooVariation[] = [];
  for (let page = 1; ; page++) {
    const r = await wooGet<WooVariation[]>(c, `products/${p.id}/variations`, { per_page: 100, page });
    out.push(...r.data);
    if (page >= r.totalPages) break;
  }
  return out.filter((v) => (v.status ?? "publish") === "publish");
}

async function variantsOf(c: WooCreds, p: WooProduct, unit: WooUnit, defaultStock: number) {
  const list = await variationsOf(c, p);
  const sharing = list.filter((v) => v.manage_stock === "parent").length;
  return list.map((v) => mapVariation(v, p, unit, defaultStock, sharing));
}

/**
 * Imports (or re-imports) published simple and variable products. Products are matched by their Woo id
 * (source = woocommerce, sourceRef = id) and variants by SKU or attributes, so running it again updates
 * prices and stock instead of duplicating. Per-product failures are recorded and the run continues.
 */
export async function runWooImport(db: Database, importId: string) {
  const [job] = await db.update(wooImports).set({ status: "running", startedAt: new Date() }).where(and(eq(wooImports.id, importId), eq(wooImports.status, "queued"))).returning();
  if (!job) return;
  const shop = await db.query.shops.findFirst({ where: eq(shops.id, job.shopId) });
  if (!shop?.wooUrl || !shop.wooConsumerKey || !shop.wooConsumerSecret) {
    await db.update(wooImports).set({ status: "failed", finishedAt: new Date(), errors: [{ product: "-", error: "WooCommerce is not connected" }] }).where(eq(wooImports.id, job.id));
    return;
  }
  const creds: WooCreds = { url: shop.wooUrl, key: shop.wooConsumerKey, secret: shop.wooConsumerSecret };
  const { unit, defaultStock, status } = job.options;
  const errors: { product: string; error: string }[] = [];
  const counts = { created: 0, updated: 0, skipped: 0 };
  const save = (extra: Partial<typeof wooImports.$inferInsert> = {}) => db.update(wooImports).set({ ...counts, errors: errors.slice(0, MAX_ERRORS), ...extra }).where(eq(wooImports.id, job.id));

  try {
    for (let page = 1; ; page++) {
      const r = await wooGet<WooProduct[]>(creds, "products", { per_page: PAGE, page, status: "publish" });
      if (page === 1) await db.update(wooImports).set({ total: r.total }).where(eq(wooImports.id, job.id));
      for (const p of r.data) {
        try {
          if (p.type !== "simple" && p.type !== "variable") {
            counts.skipped++;
            continue;
          }
          const mapped: MappedVariant[] = p.type === "simple" ? [mapSimple(p, unit, defaultStock)] : await variantsOf(creds, p, unit, defaultStock);
          if (!mapped.length) {
            counts.skipped++;
            continue;
          }
          const existing = await db.query.products.findFirst({ where: and(eq(products.shopId, shop.id), eq(products.source, "woocommerce"), eq(products.sourceRef, String(p.id))) });
          const current = existing ? await db.select().from(productVariants).where(eq(productVariants.productId, existing.id)) : [];
          const byKey = new Map(current.map((v) => [variantKey({ sku: v.sku, attributes: v.attributes }), v.id]));
          const images = existing?.images.length
            ? existing.images
            : (await Promise.all((p.images ?? []).slice(0, 6).map((i) => copyImage(i.src, shop.id, "woo")))).filter((u): u is string => Boolean(u));
          await db.transaction(async (tx) => {
            const saved = await upsertProduct(
              tx,
              shop,
              {
                title: p.name.slice(0, 200),
                description: stripHtml(p.description || p.short_description),
                categoryId: await categoryId(db, shop.id, p.categories?.[0]?.name),
                images,
                status: existing?.status === "archived" ? "archived" : status,
                variants: mapped.map((v) => ({ ...v, id: byKey.get(variantKey(v)), lowStockThreshold: 3 })),
              },
              job.createdBy ?? shop.ownerId,
              existing?.id,
            );
            if (!existing) await tx.update(products).set({ source: "woocommerce", sourceRef: String(p.id) }).where(eq(products.id, saved.id));
          });
          if (existing) counts.updated++;
          else counts.created++;
        } catch (err) {
          errors.push({ product: p.name, error: (err as Error).message.slice(0, 200) });
        }
        await save();
      }
      if (page >= r.totalPages || r.data.length === 0) break;
    }
    await save({ status: "done", finishedAt: new Date() });
  } catch (err) {
    errors.push({ product: "-", error: (err as Error).message.slice(0, 200) });
    await save({ status: "failed", finishedAt: new Date() });
  }
}

export const unitForCurrency = (currency: string | null) => (currency === "IRR" ? "rial" : "toman");
