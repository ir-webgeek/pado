import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { discounts, shippingMethods } from "@shopino/db";
import { discountInputSchema } from "@shopino/shared";
import type { Ctx } from "../../lib/context";
import { requireShop } from "../../lib/auth";
import { notFound } from "../../lib/errors";

const params = z.object({ shopId: z.string().uuid() });
const withId = params.extend({ id: z.string().uuid() });
const shippingInput = z.object({
  name: z.string().min(1).max(60),
  carrier: z.enum(["manual", "courier", "post", "postex", "tipax", "pickup"]),
  price: z.number().int().min(0),
  freeOver: z.number().int().min(0).nullable().optional(),
  active: z.boolean().default(true),
  sort: z.number().int().default(0),
});

export const discountRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/:shopId/discounts", { preHandler: requireShop(ctx), schema: { params } }, async (req) =>
      ctx.db.select().from(discounts).where(eq(discounts.shopId, req.shop.id)).orderBy(desc(discounts.createdAt)),
    );
    app.post("/:shopId/discounts", { preHandler: requireShop(ctx, "admin"), schema: { params, body: discountInputSchema } }, async (req) => {
      const [row] = await ctx.db.insert(discounts).values({ ...req.body, shopId: req.shop.id }).returning();
      return row;
    });
    app.patch("/:shopId/discounts/:id", { preHandler: requireShop(ctx, "admin"), schema: { params: withId, body: discountInputSchema.partial() } }, async (req) => {
      const [row] = await ctx.db.update(discounts).set(req.body).where(and(eq(discounts.id, req.params.id), eq(discounts.shopId, req.shop.id))).returning();
      if (!row) throw notFound("discount");
      return row;
    });

    app.get("/:shopId/shipping-methods", { preHandler: requireShop(ctx), schema: { params } }, async (req) =>
      ctx.db.select().from(shippingMethods).where(eq(shippingMethods.shopId, req.shop.id)).orderBy(shippingMethods.sort),
    );
    app.post("/:shopId/shipping-methods", { preHandler: requireShop(ctx, "admin"), schema: { params, body: shippingInput } }, async (req) => {
      const [row] = await ctx.db.insert(shippingMethods).values({ ...req.body, shopId: req.shop.id }).returning();
      return row;
    });
    app.put("/:shopId/shipping-methods/:id", { preHandler: requireShop(ctx, "admin"), schema: { params: withId, body: shippingInput } }, async (req) => {
      const [row] = await ctx.db.update(shippingMethods).set(req.body).where(and(eq(shippingMethods.id, req.params.id), eq(shippingMethods.shopId, req.shop.id))).returning();
      if (!row) throw notFound("shipping method");
      return row;
    });
  };
