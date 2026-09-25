import { and, eq, isNotNull } from "drizzle-orm";
import { productVariants, resolveShopSettings, shops, type Database } from "@shopino/db";
import { env } from "../../config";
import { badRequest } from "../../lib/errors";
import { readPath, tomanFromUsd } from "./usd";

/** Recompute every USD-linked variant price for a shop from its current rate. Returns updated count. */
export async function applyUsdPricing(db: Database, shopId: string): Promise<number> {
  const shop = await db.query.shops.findFirst({ where: eq(shops.id, shopId) });
  if (!shop) return 0;
  const { pricing } = resolveShopSettings(shop.settings);
  if (!pricing.usdEnabled || pricing.usdRate <= 0) return 0;
  const variants = await db
    .select({ id: productVariants.id, priceUsdCents: productVariants.priceUsdCents, price: productVariants.price })
    .from(productVariants)
    .where(and(eq(productVariants.shopId, shopId), isNotNull(productVariants.priceUsdCents)));
  let changed = 0;
  for (const v of variants) {
    const price = tomanFromUsd(v.priceUsdCents!, pricing.usdRate, pricing.markupPercent, pricing.roundTo);
    if (price !== v.price) {
      await db.update(productVariants).set({ price }).where(eq(productVariants.id, v.id));
      changed++;
    }
  }
  return changed;
}

export async function setUsdRate(db: Database, shopId: string, rate: number) {
  const shop = await db.query.shops.findFirst({ where: eq(shops.id, shopId), columns: { settings: true } });
  if (!shop) throw badRequest("shop_not_found");
  const settings = { ...shop.settings, pricing: { ...shop.settings.pricing, usdRate: rate, rateUpdatedAt: new Date().toISOString() } };
  await db.update(shops).set({ settings }).where(eq(shops.id, shopId));
  return applyUsdPricing(db, shopId);
}

/** Optional scheduled refresh from USD_RATE_URL for shops that opted into auto-fetch. */
export async function refreshUsdRateFromSource(db: Database) {
  if (!env.USD_RATE_URL) return { skipped: true };
  const res = await fetch(env.USD_RATE_URL, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`rate source responded ${res.status}`);
  const value = readPath(await res.json(), env.USD_RATE_JSON_PATH);
  if (!value) throw new Error(`no numeric rate at ${env.USD_RATE_JSON_PATH}`);
  const rate = Math.round(value * env.USD_RATE_MULTIPLIER);
  const all = await db.select({ id: shops.id, settings: shops.settings }).from(shops);
  let updated = 0;
  for (const s of all) {
    const p = resolveShopSettings(s.settings).pricing;
    if (p.usdEnabled && p.autoFetch) {
      await setUsdRate(db, s.id, rate);
      updated++;
    }
  }
  return { rate, shops: updated };
}
