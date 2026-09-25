import { and, eq, inArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { categories, igMedia, shops, type Database, type ExtractedProduct } from "@shopino/db";
import type { ProductInput } from "@shopino/shared";
import { env, publicApiUrl } from "../../config";
import type { ShopCtx } from "../../lib/auth";
import { badRequest, notFound } from "../../lib/errors";
import { chargeAi, structured } from "../agent/llm";
import { slugify, upsertProduct } from "../catalog/service";
import { assertPublicHttpsUrl } from "../../lib/safe-url";
import { listMedia, type IgAccount } from "./client";

/** Pull the latest posts and reels into ig_media (idempotent on media id). */
export async function syncMedia(db: Database, shopId: string, limit = 60) {
  const shop = await db.query.shops.findFirst({ where: eq(shops.id, shopId) });
  if (!shop?.igUserId || !shop.igAccessToken) throw badRequest("instagram_not_connected", "connect Instagram first");
  const account: IgAccount = { igUserId: shop.igUserId, accessToken: shop.igAccessToken };
  const items = await listMedia(account, limit);
  let added = 0;
  for (const m of items) {
    const childUrls = (m.children?.data ?? []).map((c) => c.media_url).filter((u): u is string => Boolean(u));
    const rows = await db
      .insert(igMedia)
      .values({
        shopId,
        mediaId: m.id,
        mediaType: m.media_type,
        caption: m.caption ?? "",
        mediaUrl: m.media_url ?? null,
        thumbnailUrl: m.thumbnail_url ?? null,
        permalink: m.permalink ?? null,
        childUrls,
        postedAt: m.timestamp ? new Date(m.timestamp) : null,
      })
      .onConflictDoNothing()
      .returning({ id: igMedia.id });
    added += rows.length;
  }
  return { fetched: items.length, added };
}

/** Add a post by hand (paste caption + image URLs) - useful before Instagram is connected. */
export async function addManualMedia(db: Database, shopId: string, input: { caption: string; imageUrls: string[] }) {
  const [row] = await db
    .insert(igMedia)
    .values({
      shopId,
      mediaId: `manual-${randomBytes(6).toString("hex")}`,
      mediaType: input.imageUrls.length > 1 ? "CAROUSEL_ALBUM" : "IMAGE",
      caption: input.caption,
      mediaUrl: input.imageUrls[0] ?? null,
      childUrls: input.imageUrls.slice(1),
      postedAt: new Date(),
    })
    .returning();
  return row!;
}

const extraction = z.object({
  isProduct: z.boolean().describe("true only if the post sells or advertises a specific item that can be bought"),
  confidence: z.number().describe("0..1"),
  title: z.string().describe("short product name in the caption's language"),
  description: z.string().describe("clean product description from the caption, without hashtags, emojis spam or contact lines"),
  price: z.number().nullable().describe("price in Toman as an integer if stated (convert 'تومن/تومان', 'هزار' = x1000, 'میلیون' = x1,000,000; Rial / 10), else null"),
  variants: z
    .array(z.object({ attributes: z.record(z.string(), z.string()), price: z.number().nullable() }))
    .describe("one entry per size/color/option combination mentioned, e.g. {size: '38'}; empty if none"),
  category: z.string().nullable().describe("a short category name, e.g. 'کیف', 'پوشاک'"),
});

/**
 * Decide whether each post is a product and extract structured data (caption + first image).
 * Runs in the worker; each post is one small vision call.
 */
export async function analyzeMedia(db: Database, shopId: string, rowIds: string[]) {
  const rows = await db.select().from(igMedia).where(and(eq(igMedia.shopId, shopId), inArray(igMedia.id, rowIds)));
  let analyzed = 0;
  for (const row of rows) {
    if (row.status === "imported") continue;
    const image = row.mediaType === "VIDEO" ? row.thumbnailUrl : row.mediaUrl;
    try {
      const { data, usage } = await structured({
        schema: extraction,
        system:
          "You turn Instagram shop posts into catalog entries. Decide if the post is a purchasable product, then extract only what the caption and image show. Never invent prices or sizes.",
        content: [
          ...(image ? [{ type: "image" as const, source: { type: "url" as const, url: image } }] : []),
          { type: "text" as const, text: `Caption:\n${row.caption || "(no caption)"}` },
        ],
        maxTokens: 3000,
        effort: "low",
      });
      await chargeAi(db, shopId, usage, { type: "ig_import", id: row.id });
      await db.update(igMedia).set({ status: "analyzed", extracted: data satisfies ExtractedProduct }).where(eq(igMedia.id, row.id));
      analyzed++;
    } catch (err) {
      await db.update(igMedia).set({ status: "analyzed", extracted: { isProduct: false, confidence: 0, title: "", description: `analysis failed: ${(err as Error).message}`, price: null, variants: [], category: null } }).where(eq(igMedia.id, row.id));
    }
  }
  return { analyzed };
}

/** Instagram CDN links expire - copy images into our own storage before using them on products. */
async function copyImage(url: string, shopId: string): Promise<string | null> {
  try {
    await assertPublicHttpsUrl(url);
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "error" });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) return null;
    const ext = type.includes("png") ? ".png" : type.includes("webp") ? ".webp" : ".jpg";
    const rel = join("shops", shopId, "ig");
    const dir = resolve(env.UPLOAD_DIR, rel);
    await mkdir(dir, { recursive: true });
    const name = `${randomBytes(10).toString("hex")}${ext}`;
    await writeFile(join(dir, name), Buffer.from(await res.arrayBuffer()));
    return `${publicApiUrl()}/uploads/${rel.split("\\").join("/")}/${name}`;
  } catch {
    return null;
  }
}

export async function importAsProduct(
  db: Database,
  shop: ShopCtx,
  rowId: string,
  edits: { title: string; description: string; price: number; variants: { attributes: Record<string, string>; price: number; stock: number }[]; categoryName?: string; status: "draft" | "active" },
  actorId: string,
) {
  const row = await db.query.igMedia.findFirst({ where: and(eq(igMedia.id, rowId), eq(igMedia.shopId, shop.id)) });
  if (!row) throw notFound("post");
  const sources = [row.mediaType === "VIDEO" ? row.thumbnailUrl : row.mediaUrl, ...row.childUrls].filter((u): u is string => Boolean(u)).slice(0, 10);
  const images = (await Promise.all(sources.map((u) => copyImage(u, shop.id)))).filter((u): u is string => Boolean(u));

  let categoryId: string | null = null;
  if (edits.categoryName) {
    const slug = slugify(edits.categoryName);
    const existing = await db.query.categories.findFirst({ where: and(eq(categories.shopId, shop.id), eq(categories.name, edits.categoryName)) });
    categoryId = existing?.id ?? (await db.insert(categories).values({ shopId: shop.id, name: edits.categoryName, slug }).onConflictDoNothing().returning())[0]?.id ?? null;
  }

  const input: ProductInput = {
    title: edits.title,
    description: edits.description,
    images,
    status: edits.status,
    categoryId,
    variants: (edits.variants.length ? edits.variants : [{ attributes: {}, price: edits.price, stock: 1 }]).map((v) => ({
      attributes: v.attributes,
      price: v.price || edits.price,
      stock: v.stock,
      lowStockThreshold: 1,
    })),
  };
  const product = await db.transaction((tx) => upsertProduct(tx, shop, input, actorId));
  await db.update(igMedia).set({ status: "imported", productId: product.id }).where(eq(igMedia.id, row.id));
  return product;
}
