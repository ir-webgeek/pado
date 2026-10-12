import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { stockReceiptSchema } from "@shopino/shared";
import type { Ctx } from "../../lib/context";
import { requireShop } from "../../lib/auth";
import { createReceipt, listReceipts, receiptDetail, setCost, stockValuation } from "./service";
import { addToPool, createPool, deletePool, listPools, removeFromPool } from "./pools";

const params = z.object({ shopId: z.string().uuid() });
const withId = params.extend({ id: z.string().uuid() });

export const inventoryRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/:shopId/inventory/receipts", { preHandler: requireShop(ctx), schema: { params } }, async (req) => listReceipts(ctx.db, req.shop.id));
    app.get("/:shopId/inventory/receipts/:id", { preHandler: requireShop(ctx), schema: { params: withId } }, async (req) => receiptDetail(ctx.db, req.shop.id, req.params.id));
    app.post("/:shopId/inventory/receipts", { preHandler: requireShop(ctx, "staff"), schema: { params, body: stockReceiptSchema } }, async (req) =>
      createReceipt(ctx.db, req.shop.id, req.body, req.user.sub),
    );
    // ---- shared stock (one inventory sold through several products)
    app.get("/:shopId/inventory/pools", { preHandler: requireShop(ctx), schema: { params } }, async (req) => listPools(ctx.db, req.shop.id));
    app.post(
      "/:shopId/inventory/pools",
      { preHandler: requireShop(ctx, "staff"), schema: { params, body: z.object({ name: z.string().trim().min(1).max(120), variantIds: z.array(z.string().uuid()).min(2).max(50), stock: z.number().int().min(0).max(1_000_000).optional() }) } },
      async (req) => ctx.db.transaction((tx) => createPool(tx, req.shop.id, req.body)),
    );
    app.post(
      "/:shopId/inventory/pools/:id/variants",
      { preHandler: requireShop(ctx, "staff"), schema: { params: withId, body: z.object({ variantId: z.string().uuid() }) } },
      async (req) => {
        await ctx.db.transaction((tx) => addToPool(tx, req.shop.id, req.params.id, req.body.variantId));
        return { ok: true };
      },
    );
    app.delete(
      "/:shopId/inventory/pools/:id/variants/:variantId",
      { preHandler: requireShop(ctx, "staff"), schema: { params: withId.extend({ variantId: z.string().uuid() }) } },
      async (req) => {
        await ctx.db.transaction((tx) => removeFromPool(tx, req.shop.id, req.params.variantId));
        return { ok: true };
      },
    );
    app.delete("/:shopId/inventory/pools/:id", { preHandler: requireShop(ctx, "admin"), schema: { params: withId } }, async (req) => {
      await deletePool(ctx.db, req.shop.id, req.params.id);
      return { ok: true };
    });
    app.get("/:shopId/inventory/valuation", { preHandler: requireShop(ctx), schema: { params } }, async (req) => stockValuation(ctx.db, req.shop.id));
    app.patch(
      "/:shopId/inventory/variants/:id/cost",
      { preHandler: requireShop(ctx, "admin"), schema: { params: withId, body: z.object({ costPrice: z.number().int().min(0).nullable() }) } },
      async (req) => {
        await setCost(ctx.db, req.shop.id, req.params.id, req.body.costPrice);
        return { ok: true };
      },
    );
  };
