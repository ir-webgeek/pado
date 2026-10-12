import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, asc, desc, eq, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { appointments, conversationEvents, conversations, customers, messages, orders, shopMembers, shops, users } from "@shopino/db";
import type { Ctx } from "../../lib/context";
import { invalidateShopCache, requireFeature, requireShop } from "../../lib/auth";
import { audit } from "../../lib/audit";
import { badRequest, notFound } from "../../lib/errors";
import { agentAvailable } from "../agent/agent";
import { handleInbound, humanReply, recentRuns } from "./pipeline";
import { CONVERSATION_STATUSES, assignConversation, logConversationEvent, setConversationStatus } from "./progress";
import { disconnectInstagram } from "../instagram/account";

const params = z.object({ shopId: z.string().uuid() });
const withId = params.extend({ id: z.string().uuid() });
const INBOX_FILTERS = ["all", "needs_human", "in_progress", "mine", "resolved", "open", "unread"] as const;
const assignee = alias(users, "assignee");

export const inboxRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/:shopId/conversations",
      { preHandler: requireShop(ctx, "staff"), schema: { params, querystring: z.object({ filter: z.enum(INBOX_FILTERS).default("all"), before: z.coerce.date().optional() }) } },
      async (req) => {
        const f = req.query.filter;
        const rows = await ctx.db
          .select({
            conv: conversations,
            customerName: customers.name,
            segment: customers.segment,
            assigneeName: assignee.name,
            lastText: sql<string | null>`(select m.text from messages m where m.conversation_id = ${conversations.id} order by m.created_at desc limit 1)`,
          })
          .from(conversations)
          .leftJoin(customers, eq(customers.id, conversations.customerId))
          .leftJoin(assignee, eq(assignee.id, conversations.assigneeId))
          .where(
            and(
              eq(conversations.shopId, req.shop.id),
              f === "needs_human" ? or(eq(conversations.status, "needs_human"), eq(conversations.needsHuman, true)) : undefined,
              f === "in_progress" || f === "resolved" || f === "open" ? eq(conversations.status, f) : undefined,
              f === "mine" ? and(eq(conversations.assigneeId, req.user.sub), sql`${conversations.status} <> 'resolved'`) : undefined,
              f === "unread" ? sql`${conversations.unread} > 0` : undefined,
              req.query.before ? lt(conversations.lastMessageAt, req.query.before) : undefined,
            ),
          )
          .orderBy(desc(conversations.lastMessageAt))
          .limit(40);
        return rows.map((r) => ({ ...r.conv, customerName: r.customerName, segment: r.segment, assigneeName: r.assigneeName, lastText: r.lastText }));
      },
    );

    // pipeline counts for the inbox tabs + who can take a chat
    app.get("/:shopId/conversations/summary", { preHandler: requireShop(ctx, "staff"), schema: { params } }, async (req) => {
      const [[counts], team] = await Promise.all([
        ctx.db
          .select({
            open: sql<number>`count(*) filter (where ${conversations.status} = 'open' and not ${conversations.needsHuman})::int`,
            needsHuman: sql<number>`count(*) filter (where ${conversations.status} = 'needs_human' or (${conversations.needsHuman} and ${conversations.status} <> 'resolved'))::int`,
            inProgress: sql<number>`count(*) filter (where ${conversations.status} = 'in_progress')::int`,
            resolved: sql<number>`count(*) filter (where ${conversations.status} = 'resolved')::int`,
            mine: sql<number>`count(*) filter (where ${conversations.assigneeId} = ${req.user.sub} and ${conversations.status} <> 'resolved')::int`,
            unread: sql<number>`count(*) filter (where ${conversations.unread} > 0)::int`,
            oldestWaiting: sql<string | null>`min(${conversations.lastInboundAt}) filter (where ${conversations.status} = 'needs_human')`,
          })
          .from(conversations)
          .where(eq(conversations.shopId, req.shop.id)),
        ctx.db
          .select({ userId: users.id, name: users.name, role: shopMembers.role })
          .from(shopMembers)
          .innerJoin(users, eq(users.id, shopMembers.userId))
          .where(eq(shopMembers.shopId, req.shop.id))
          .orderBy(asc(users.name)),
      ]);
      return { counts, team, me: req.user.sub };
    });

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
      const events = await ctx.db
        .select({ id: conversationEvents.id, type: conversationEvents.type, data: conversationEvents.data, createdAt: conversationEvents.createdAt, actorName: users.name, actorId: conversationEvents.actorId })
        .from(conversationEvents)
        .leftJoin(users, eq(users.id, conversationEvents.actorId))
        .where(eq(conversationEvents.conversationId, conv.id))
        .orderBy(desc(conversationEvents.createdAt))
        .limit(50);
      return {
        conversation: conv,
        events: events.reverse(),
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
      {
        preHandler: requireShop(ctx, "staff"),
        schema: {
          params: withId,
          body: z.object({
            mode: z.enum(["agent", "human"]).optional(),
            needsHuman: z.boolean().optional(),
            status: z.enum(CONVERSATION_STATUSES).optional(),
            assigneeId: z.string().uuid().nullable().optional(),
          }),
        },
      },
      async (req) => {
        const { mode, needsHuman, status, assigneeId } = req.body;
        const where = and(eq(conversations.id, req.params.id), eq(conversations.shopId, req.shop.id));
        let row = await ctx.db.query.conversations.findFirst({ where });
        if (!row) throw notFound("conversation");
        const actor = req.user.sub;
        if (assigneeId !== undefined) {
          if (assigneeId) {
            const member = await ctx.db.query.shopMembers.findFirst({ where: and(eq(shopMembers.shopId, req.shop.id), eq(shopMembers.userId, assigneeId)), columns: { id: true } });
            if (!member) throw badRequest("invalid_assignee", "that person is not on this shop's team");
          }
          row = (await assignConversation(ctx.db, req.shop.id, row.id, assigneeId, actor)) ?? row;
        }
        // legacy flag toggle maps onto the pipeline
        const nextStatus = status ?? (needsHuman === true ? "needs_human" : needsHuman === false && row.status === "needs_human" ? "open" : undefined);
        if (nextStatus && nextStatus !== row.status) row = (await setConversationStatus(ctx.db, req.shop.id, row.id, nextStatus, actor)) ?? row;
        if (mode && mode !== row.mode) {
          [row] = await ctx.db.update(conversations).set({ mode }).where(where).returning();
          await logConversationEvent(ctx.db, req.shop.id, row!.id, "mode", { mode }, actor);
        }
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
          .set({ igUserId: req.body.igUserId, igAccessToken: req.body.accessToken, igUsername: req.body.username, igConnectedAt: new Date(), igTokenRefreshedAt: null, igLastError: null })
          .where(eq(shops.id, req.shop.id));
        invalidateShopCache(req.shop.id);
        await audit(ctx.db, req.shop.id, { type: "user", id: req.user.sub }, "instagram.connect", "shop", req.shop.id, { igUserId: req.body.igUserId });
        return { ok: true };
      },
    );
    app.post("/:shopId/instagram/disconnect", { preHandler: requireShop(ctx, "owner"), schema: { params } }, async (req) => {
      await disconnectInstagram(ctx.db, req.shop.id);
      await audit(ctx.db, req.shop.id, { type: "user", id: req.user.sub }, "instagram.disconnect", "shop", req.shop.id);
      invalidateShopCache(req.shop.id);
      return { ok: true };
    });

  };
