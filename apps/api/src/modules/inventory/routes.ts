import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { stockReceiptSchema } from "@shopino/shared";
import type { Ctx } from "../../lib/context";
import { requireShop } from "../../lib/auth";
import { createReceipt, listReceipts, receiptDetail, setCost, stockValuation } from "./service";

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
