import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { categories, inventoryMovements, products } from "@shopino/db";
import { categoryInputSchema, productInputSchema, stockAdjustSchema } from "@shopino/shared";
import type { Ctx } from "../../lib/context";
import { requireShop } from "../../lib/auth";
import { audit } from "../../lib/audit";
import { notFound } from "../../lib/errors";
import { adjustStock, getProduct, listProducts, lowStock, slugify, upsertProduct } from "./service";

const params = z.object({ shopId: z.string().uuid() });
const withId = params.extend({ id: z.string().uuid() });

export const catalogRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    // ---- categories
    app.get("/:shopId/categories", { preHandler: requireShop(ctx), schema: { params } }, async (req) =>
      ctx.db.select().from(categories).where(eq(categories.shopId, req.shop.id)).orderBy(categories.sort),
    );
    app.post("/:shopId/categories", { preHandler: requireShop(ctx, "staff"), schema: { params, body: categoryInputSchema } }, async (req) => {
      const [row] = await ctx.db
        .insert(categories)
        .values({ ...req.body, slug: req.body.slug ?? slugify(req.body.name), shopId: req.shop.id })
        .returning();
      return row;
    });
    app.patch("/:shopId/categories/:id", { preHandler: requireShop(ctx, "staff"), schema: { params: withId, body: categoryInputSchema.partial() } }, async (req) => {
      const [row] = await ctx.db
        .update(categories)
        .set(req.body)
        .where(and(eq(categories.id, req.params.id), eq(categories.shopId, req.shop.id)))
        .returning();
      if (!row) throw notFound("category");
      return row;
    });
    app.delete("/:shopId/categories/:id", { preHandler: requireShop(ctx, "admin"), schema: { params: withId } }, async (req) => {
      await ctx.db.delete(categories).where(and(eq(categories.id, req.params.id), eq(categories.shopId, req.shop.id)));
      return { ok: true };
    });

    // ---- products
    app.get(
      "/:shopId/products",
      {
        preHandler: requireShop(ctx),
        schema: {
          params,
          querystring: z.object({
            q: z.string().optional(),
            status: z.enum(["draft", "active", "archived"]).optional(),
            categoryId: z.string().uuid().optional(),
            limit: z.coerce.number().int().min(1).max(100).default(30),
            offset: z.coerce.number().int().min(0).default(0),
          }),
        },
      },
      async (req) => ({ items: await listProducts(ctx.db, req.shop.id, req.query) }),
    );
    app.get("/:shopId/products/:id", { preHandler: requireShop(ctx), schema: { params: withId } }, async (req) => getProduct(ctx.db, req.shop.id, req.params.id));
    app.post("/:shopId/products", { preHandler: requireShop(ctx, "staff"), schema: { params, body: productInputSchema } }, async (req) =>
      ctx.db.transaction(async (tx) => {
        const product = await upsertProduct(tx, req.shop, req.body, req.user.sub);
        await audit(tx, req.shop.id, { type: "user", id: req.user.sub }, "product.create", "product", product.id);
        return product;
      }),
    );
    app.put("/:shopId/products/:id", { preHandler: requireShop(ctx, "staff"), schema: { params: withId, body: productInputSchema } }, async (req) =>
      ctx.db.transaction(async (tx) => {
        const product = await upsertProduct(tx, req.shop, req.body, req.user.sub, req.params.id);
        await audit(tx, req.shop.id, { type: "user", id: req.user.sub }, "product.update", "product", product.id);
        return product;
      }),
    );
    app.delete("/:shopId/products/:id", { preHandler: requireShop(ctx, "admin"), schema: { params: withId } }, async (req) => {
      // archive instead of hard delete so order history keeps its product link
      const [row] = await ctx.db
        .update(products)
        .set({ status: "archived" })
        .where(and(eq(products.id, req.params.id), eq(products.shopId, req.shop.id)))
        .returning({ id: products.id });
      if (!row) throw notFound("product");
      return { ok: true };
    });

    // ---- inventory
    app.get("/:shopId/inventory/low-stock", { preHandler: requireShop(ctx), schema: { params } }, async (req) => lowStock(ctx.db, req.shop.id, 50));
    app.post("/:shopId/inventory/adjust", { preHandler: requireShop(ctx, "staff"), schema: { params, body: stockAdjustSchema } }, async (req) => {
      const stock = await adjustStock(ctx.db, req.shop.id, req.body, req.user.sub);
      return { stock };
    });
    app.get(
      "/:shopId/inventory/movements",
      { preHandler: requireShop(ctx), schema: { params, querystring: z.object({ variantId: z.string().uuid().optional() }) } },
      async (req) =>
        ctx.db
          .select()
          .from(inventoryMovements)
          .where(
            and(eq(inventoryMovements.shopId, req.shop.id), req.query.variantId ? eq(inventoryMovements.variantId, req.query.variantId) : undefined),
          )
          .orderBy(desc(inventoryMovements.createdAt))
          .limit(200),
    );
  };
