import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { usdRateSchema } from "@shopino/shared";
import type { Ctx } from "../../lib/context";
import { invalidateShopCache, requireShop } from "../../lib/auth";
import { applyUsdPricing, setUsdRate } from "./service";

const params = z.object({ shopId: z.string().uuid() });

export const pricingRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    app.post("/:shopId/pricing/usd-rate", { preHandler: requireShop(ctx, "admin"), schema: { params, body: usdRateSchema } }, async (req) => {
      const updated = await setUsdRate(ctx.db, req.shop.id, req.body.rate);
      invalidateShopCache(req.shop.id);
      return { updated };
    });
    app.post("/:shopId/pricing/recompute", { preHandler: requireShop(ctx, "admin"), schema: { params } }, async (req) => ({
      updated: await applyUsdPricing(ctx.db, req.shop.id),
    }));
  };
