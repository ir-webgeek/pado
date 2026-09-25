import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { Ctx } from "./lib/context";
import { requireShop } from "./lib/auth";
import { saveUpload } from "./lib/uploads";
import { appointmentRoutes } from "./modules/appointments/routes";
import { authRoutes } from "./modules/auth/routes";
import { campaignRoutes } from "./modules/campaigns/routes";
import { catalogRoutes } from "./modules/catalog/routes";
import { customerRoutes } from "./modules/customers/routes";
import { discountRoutes } from "./modules/discounts/routes";
import { inboxRoutes } from "./modules/inbox/routes";
import { instagramWebhook } from "./modules/instagram/webhook";
import { orderRoutes } from "./modules/orders/routes";
import { reportRoutes } from "./modules/reports/routes";
import { shopRoutes } from "./modules/shops/routes";
import { payCallbackRoutes, storefrontRoutes } from "./modules/storefront/routes";
import { walletRoutes } from "./modules/wallet/routes";

const uploadRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    app.post("/:shopId/uploads", { preHandler: requireShop(ctx, "staff"), schema: { params: z.object({ shopId: z.string().uuid() }) } }, async (req) => ({
      url: await saveUpload(await req.file(), `shops/${req.shop.id}`),
    }));
  };

export const routes =
  (ctx: Ctx): FastifyPluginAsync =>
  async (app) => {
    await app.register(authRoutes(ctx), { prefix: "/auth" });
    // every tenant route lives under /v1/shops/:shopId/...
    for (const r of [shopRoutes, catalogRoutes, orderRoutes, customerRoutes, discountRoutes, appointmentRoutes, inboxRoutes, walletRoutes, campaignRoutes, reportRoutes, uploadRoutes]) {
      await app.register(r(ctx), { prefix: "/shops" });
    }
    await app.register(storefrontRoutes(ctx), { prefix: "/public" });
    await app.register(payCallbackRoutes(ctx), { prefix: "/pay" });
    await app.register(instagramWebhook(ctx), { prefix: "/webhooks" });
  };
