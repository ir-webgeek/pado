import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { campaigns, customers } from "@shopino/db";
import { campaignInputSchema } from "@shopino/shared";
import { env } from "../../config";
import type { Ctx } from "../../lib/context";
import { requireShop } from "../../lib/auth";
import { notFound, paymentRequired } from "../../lib/errors";
import { smsParts } from "../notifications/sms";
import { walletBalance } from "../wallet/service";

const params = z.object({ shopId: z.string().uuid() });

export function segmentWhere(shopId: string, segment: string) {
  return and(
    eq(customers.shopId, shopId),
    isNotNull(customers.phone),
    eq(customers.smsOptOut, false),
    segment === "all" ? undefined : eq(customers.segment, segment as "vip"),
  );
}

export const campaignRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/:shopId/campaigns", { preHandler: requireShop(ctx), schema: { params } }, async (req) =>
      ctx.db.select().from(campaigns).where(eq(campaigns.shopId, req.shop.id)).orderBy(desc(campaigns.createdAt)).limit(100),
    );

    app.post("/:shopId/campaigns/preview", { preHandler: requireShop(ctx, "admin"), schema: { params, body: campaignInputSchema } }, async (req) => {
      const [row] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(customers).where(segmentWhere(req.shop.id, req.body.segment));
      const recipients = row?.n ?? 0;
      const parts = smsParts(req.body.message);
      return { recipients, parts, cost: recipients * parts * env.SMS_COST_PER_PART, balance: await walletBalance(ctx.db, req.shop.id) };
    });

    app.post("/:shopId/campaigns", { preHandler: requireShop(ctx, "admin"), schema: { params, body: campaignInputSchema } }, async (req) => {
      const [row] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(customers).where(segmentWhere(req.shop.id, req.body.segment));
      const recipients = row?.n ?? 0;
      const cost = recipients * smsParts(req.body.message) * env.SMS_COST_PER_PART;
      if (cost > (await walletBalance(ctx.db, req.shop.id))) throw paymentRequired("wallet_insufficient", "top up your wallet to send this campaign");
      const [c] = await ctx.db.insert(campaigns).values({ ...req.body, shopId: req.shop.id, status: "queued", recipients }).returning();
      await ctx.queues.add("campaign.send", { campaignId: c!.id }, { jobId: `campaign-${c!.id}` });
      return c;
    });

    app.get("/:shopId/campaigns/:id", { preHandler: requireShop(ctx), schema: { params: params.extend({ id: z.string().uuid() }) } }, async (req) => {
      const c = await ctx.db.query.campaigns.findFirst({ where: and(eq(campaigns.id, req.params.id), eq(campaigns.shopId, req.shop.id)) });
      if (!c) throw notFound("campaign");
      return c;
    });
  };
