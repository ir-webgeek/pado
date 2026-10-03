import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { appointments, conversations, customers, messages, orders, shops } from "@shopino/db";
import type { Ctx } from "../../lib/context";
import { invalidateShopCache, requireFeature, requireShop } from "../../lib/auth";
import { audit } from "../../lib/audit";
import { badRequest, notFound } from "../../lib/errors";
import { agentAvailable } from "../agent/agent";
import { handleInbound, humanReply, recentRuns } from "./pipeline";

const params = z.object({ shopId: z.string().uuid() });
const withId = params.extend({ id: z.string().uuid() });

export const inboxRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/:shopId/conversations",
      { preHandler: requireShop(ctx, "staff"), schema: { params, querystring: z.object({ filter: z.enum(["all", "needs_human", "unread"]).default("all"), before: z.coerce.date().optional() }) } },
      async (req) => {
        const rows = await ctx.db
          .select({
            conv: conversations,
            customerName: customers.name,
            segment: customers.segment,
            lastText: sql<string | null>`(select m.text from messages m where m.conversation_id = ${conversations.id} order by m.created_at desc limit 1)`,
          })
          .from(conversations)
          .leftJoin(customers, eq(customers.id, conversations.customerId))
          .where(
            and(
              eq(conversations.shopId, req.shop.id),
              req.query.filter === "needs_human" ? eq(conversations.needsHuman, true) : undefined,
              req.query.filter === "unread" ? sql`${conversations.unread} > 0` : undefined,
              req.query.before ? lt(conversations.lastMessageAt, req.query.before) : undefined,
            ),
          )
          .orderBy(desc(conversations.lastMessageAt))
          .limit(40);
        return rows.map((r) => ({ ...r.conv, customerName: r.customerName, segment: r.segment, lastText: r.lastText }));
      },
    );

    app.get("/:shopId/conversations/:id/messages", { preHandler: requireShop(ctx, "staff"), schema: { params: withId } }, async (req) => {
      const conv = await ctx.db.query.conversations.findFirst({ where: and(eq(conversations.id, req.params.id), eq(conversations.shopId, req.shop.id)) });
      if (!conv) throw notFound("conversation");
      const rows = await ctx.db.select().from(messages).where(eq(messages.conversationId, conv.id)).orderBy(desc(messages.createdAt)).limit(100);
      await ctx.db.update(conversations).set({ unread: 0 }).where(eq(conversations.id, conv.id));
      // what this chat led to on the shop's site (orders/bookings placed there carry the conversation)
      const [siteOrders, siteBookings] = await Promise.all([
        ctx.db
          .select({ id: orders.id, code: orders.code, total: orders.total, status: orders.status, paymentStatus: orders.paymentStatus })
          .from(orders)
          .where(and(eq(orders.conversationId, conv.id), eq(orders.channel, "web")))
          .orderBy(desc(orders.createdAt))
          .limit(10),
        ctx.db
          .select({ id: appointments.id, code: appointments.code, status: appointments.status, startsAt: appointments.startsAt })
          .from(appointments)
          .where(and(eq(appointments.conversationId, conv.id), eq(appointments.channel, "web")))
          .orderBy(desc(appointments.createdAt))
          .limit(10),
      ]);
      return {
        conversation: conv,
        messages: rows.reverse(),
        agentRuns: await recentRuns(ctx.db, conv.id),
        site: { visits: conv.siteVisits, lastAt: conv.lastSiteVisitAt, lastPath: conv.lastSitePath, orders: siteOrders, bookings: siteBookings },
      };
    });

    app.post(
      "/:shopId/conversations/:id/reply",
      { preHandler: requireShop(ctx, "staff"), schema: { params: withId, body: z.object({ text: z.string().min(1).max(2000) }) } },
      async (req) => {
        const m = await humanReply(ctx.db, req.shop.id, req.params.id, req.body.text, req.user.sub);
        if (!m) throw notFound("conversation");
        return m;
      },
    );

    app.patch(
      "/:shopId/conversations/:id",
      { preHandler: requireShop(ctx, "staff"), schema: { params: withId, body: z.object({ mode: z.enum(["agent", "human"]).optional(), needsHuman: z.boolean().optional() }) } },
      async (req) => {
        const [row] = await ctx.db
          .update(conversations)
          .set(req.body)
          .where(and(eq(conversations.id, req.params.id), eq(conversations.shopId, req.shop.id)))
          .returning();
        if (!row) throw notFound("conversation");
        return row;
      },
    );

    // try the DM flow (automations, then AI when enabled) from the panel without Instagram
    app.post(
      "/:shopId/agent/playground",
      { preHandler: requireShop(ctx, "admin"), schema: { params, body: z.object({ text: z.string().min(1).max(1000), reset: z.boolean().default(false) }) }, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
      async (req) => {
        const externalUserId = `playground-${req.user.sub}`;
        if (req.body.reset) {
          await ctx.db.delete(conversations).where(and(eq(conversations.shopId, req.shop.id), eq(conversations.channel, "web"), eq(conversations.externalUserId, externalUserId)));
        }
        // playground always runs in agent mode even if a previous test handed off
        await ctx.db
          .update(conversations)
          .set({ mode: "agent" })
          .where(and(eq(conversations.shopId, req.shop.id), eq(conversations.channel, "web"), eq(conversations.externalUserId, externalUserId)));
        return handleInbound(ctx.db, ctx.queues, ctx.redis, { shopId: req.shop.id, channel: "web", externalUserId, username: "playground", text: req.body.text });
      },
    );

    // ---- Instagram connection (token from the Instagram Login flow of your Meta app)
    app.post(
      "/:shopId/instagram/connect",
      { preHandler: requireShop(ctx, "owner"), schema: { params, body: z.object({ igUserId: z.string().min(3), accessToken: z.string().min(20), username: z.string().max(60).optional() }) } },
      async (req) => {
        await ctx.db
          .update(shops)
          .set({ igUserId: req.body.igUserId, igAccessToken: req.body.accessToken, igUsername: req.body.username })
          .where(eq(shops.id, req.shop.id));
        invalidateShopCache(req.shop.id);
        await audit(ctx.db, req.shop.id, { type: "user", id: req.user.sub }, "instagram.connect", "shop", req.shop.id, { igUserId: req.body.igUserId });
        return { ok: true };
      },
    );
    app.post("/:shopId/instagram/disconnect", { preHandler: requireShop(ctx, "owner"), schema: { params } }, async (req) => {
      await ctx.db.update(shops).set({ igUserId: null, igAccessToken: null }).where(eq(shops.id, req.shop.id));
      return { ok: true };
    });

  };
