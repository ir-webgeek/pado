import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyRequest } from "fastify";
import { and, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  agentRuns,
  appointments,
  automationEvents,
  automationRules,
  conversations,
  customers,
  messages,
  orders,
  payments,
  services,
  shops,
  staff,
  users,
} from "@shopino/db";
import { APPOINTMENT_STATUSES, PLAN_IDS } from "@shopino/shared";
import type { Ctx } from "../../lib/context";
import { authenticate, invalidateShopCache } from "../../lib/auth";
import { audit } from "../../lib/audit";
import { TtlCache } from "../../lib/cache";
import { forbidden, notFound } from "../../lib/errors";
import { walletMove } from "../wallet/service";

const adminCache = new TtlCache<boolean>(30_000);

/**
 * Platform operator dashboard: every shop (client), their reservations, and how the automated DM
 * layer (static rules + AI agent) is handling conversations.
 */
export const adminRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook("preHandler", async (req: FastifyRequest) => {
      await authenticate(req);
      let ok = adminCache.get(req.user.sub);
      if (ok === undefined) {
        const u = await ctx.db.query.users.findFirst({ where: eq(users.id, req.user.sub), columns: { isSuperAdmin: true } });
        ok = Boolean(u?.isSuperAdmin);
        adminCache.set(req.user.sub, ok);
      }
      if (!ok) throw forbidden("super admin only");
    });

    const since = (days: number) => new Date(Date.now() - days * 86400_000);

    app.get("/overview", async () => {
      const [byPlan, [shopStats], [gmv], [bookings], [ai], [auto], [conv]] = await Promise.all([
        ctx.db.select({ plan: shops.plan, n: sql<number>`count(*)::int` }).from(shops).groupBy(shops.plan),
        ctx.db.select({ total: sql<number>`count(*)::int`, suspended: sql<number>`count(*) filter (where ${shops.suspendedAt} is not null)::int`, fresh: sql<number>`count(*) filter (where ${shops.createdAt} >= ${since(30).toISOString()})::int` }).from(shops),
        ctx.db
          .select({ total: sql<number>`coalesce(sum(${payments.amount}),0)::bigint`, fees: sql<number>`coalesce(sum(${payments.platformFee}),0)::bigint`, n: sql<number>`count(*)::int` })
          .from(payments)
          .where(and(eq(payments.status, "paid"), gte(payments.paidAt, since(30)))),
        ctx.db
          .select({ total: sql<number>`count(*)::int`, online: sql<number>`count(*) filter (where ${appointments.channel} in ('web','instagram','agent'))::int`, offline: sql<number>`count(*) filter (where ${appointments.channel} in ('pos','phone'))::int`, noShow: sql<number>`count(*) filter (where ${appointments.status} = 'no_show')::int` })
          .from(appointments)
          .where(gte(appointments.createdAt, since(30))),
        ctx.db
          .select({ runs: sql<number>`count(*)::int`, cost: sql<number>`coalesce(sum(${agentRuns.cost}),0)::bigint`, handoffs: sql<number>`count(*) filter (where ${agentRuns.handoff} is not null)::int`, errors: sql<number>`count(*) filter (where ${agentRuns.error} is not null)::int`, avgMs: sql<number>`coalesce(avg(${agentRuns.durationMs}),0)::int` })
          .from(agentRuns)
          .where(gte(agentRuns.createdAt, since(7))),
        ctx.db
          .select({ hits: sql<number>`count(*)::int`, failed: sql<number>`count(*) filter (where not ${automationEvents.ok})::int` })
          .from(automationEvents)
          .where(gte(automationEvents.createdAt, since(7))),
        ctx.db.select({ needsHuman: sql<number>`count(*) filter (where ${conversations.needsHuman})::int`, total: sql<number>`count(*)::int` }).from(conversations),
      ]);
      return {
        shops: { ...shopStats, byPlan: Object.fromEntries(byPlan.map((p) => [p.plan, p.n])) },
        payments30d: { volume: Number(gmv?.total ?? 0), platformFees: Number(gmv?.fees ?? 0), count: gmv?.n ?? 0 },
        bookings30d: bookings,
        ai7d: { ...ai, cost: Number(ai?.cost ?? 0) },
        automations7d: auto,
        conversations: conv,
      };
    });

    app.get(
      "/shops",
      { schema: { querystring: z.object({ q: z.string().optional(), plan: z.enum(PLAN_IDS).optional(), limit: z.coerce.number().int().max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }) } },
      async (req) => {
        const { q, plan, limit, offset } = req.query;
        return ctx.db
          .select({
            id: shops.id,
            name: shops.name,
            slug: shops.slug,
            kind: shops.kind,
            plan: shops.plan,
            planExpiresAt: shops.planExpiresAt,
            walletBalance: shops.walletBalance,
            suspendedAt: shops.suspendedAt,
            instagram: shops.igUsername,
            createdAt: shops.createdAt,
            ownerPhone: users.phone,
            bookings30d: sql<number>`(select count(*) from appointments a where a.shop_id = ${shops.id} and a.created_at >= now() - interval '30 days')::int`,
            orders30d: sql<number>`(select count(*) from orders o where o.shop_id = ${shops.id} and o.created_at >= now() - interval '30 days')::int`,
            aiRuns7d: sql<number>`(select count(*) from agent_runs r where r.shop_id = ${shops.id} and r.created_at >= now() - interval '7 days')::int`,
          })
          .from(shops)
          .innerJoin(users, eq(users.id, shops.ownerId))
          .where(and(q ? or(ilike(shops.name, `%${q}%`), ilike(shops.slug, `%${q}%`), ilike(users.phone, `%${q}%`)) : undefined, plan ? eq(shops.plan, plan) : undefined))
          .orderBy(desc(shops.createdAt))
          .limit(limit)
          .offset(offset);
      },
    );

    const idParams = z.object({ id: z.string().uuid() });

    app.patch(
      "/shops/:id",
      { schema: { params: idParams, body: z.object({ plan: z.enum(PLAN_IDS).optional(), planExpiresAt: z.coerce.date().nullable().optional(), suspended: z.boolean().optional() }) } },
      async (req) => {
        const { suspended, ...rest } = req.body;
        const [row] = await ctx.db
          .update(shops)
          .set({ ...rest, ...(suspended === undefined ? {} : { suspendedAt: suspended ? new Date() : null }) })
          .where(eq(shops.id, req.params.id))
          .returning({ id: shops.id, plan: shops.plan, suspendedAt: shops.suspendedAt, planExpiresAt: shops.planExpiresAt });
        if (!row) throw notFound("shop");
        invalidateShopCache(row.id);
        await audit(ctx.db, row.id, { type: "user", id: req.user.sub }, "admin.shop_update", "shop", row.id, req.body);
        return row;
      },
    );

    app.post("/shops/:id/wallet", { schema: { params: idParams, body: z.object({ amount: z.number().int().min(-100_000_000).max(100_000_000), note: z.string().max(200) }) } }, async (req) => {
      const balance = await walletMove(ctx.db, req.params.id, "adjustment", req.body.amount, { type: "admin", id: req.user.sub }, { note: req.body.note });
      return { balance };
    });

    app.get(
      "/appointments",
      {
        schema: {
          querystring: z.object({
            shopId: z.string().uuid().optional(),
            status: z.enum(APPOINTMENT_STATUSES).optional(),
            from: z.coerce.date().optional(),
            to: z.coerce.date().optional(),
            limit: z.coerce.number().int().max(200).default(100),
          }),
        },
      },
      async (req) => {
        const { shopId, status, from, to, limit } = req.query;
        return ctx.db
          .select({
            id: appointments.id,
            code: appointments.code,
            status: appointments.status,
            channel: appointments.channel,
            startsAt: appointments.startsAt,
            price: appointments.price,
            paymentStatus: appointments.paymentStatus,
            refundStatus: appointments.refundStatus,
            shopName: shops.name,
            serviceName: services.name,
            staffName: staff.name,
            customerName: customers.name,
            customerPhone: customers.phone,
          })
          .from(appointments)
          .innerJoin(shops, eq(shops.id, appointments.shopId))
          .innerJoin(services, eq(services.id, appointments.serviceId))
          .innerJoin(staff, eq(staff.id, appointments.staffId))
          .innerJoin(customers, eq(customers.id, appointments.customerId))
          .where(
            and(
              shopId ? eq(appointments.shopId, shopId) : undefined,
              status ? eq(appointments.status, status) : undefined,
              from ? gte(appointments.startsAt, from) : undefined,
              to ? lt(appointments.startsAt, to) : undefined,
            ),
          )
          .orderBy(desc(appointments.startsAt))
          .limit(limit);
      },
    );

    app.get(
      "/conversations",
      { schema: { querystring: z.object({ shopId: z.string().uuid().optional(), filter: z.enum(["all", "needs_human", "agent", "human"]).default("all") }) } },
      async (req) => {
        const { shopId, filter } = req.query;
        return ctx.db
          .select({
            id: conversations.id,
            channel: conversations.channel,
            username: conversations.username,
            mode: conversations.mode,
            needsHuman: conversations.needsHuman,
            lastMessageAt: conversations.lastMessageAt,
            shopName: shops.name,
            lastText: sql<string | null>`(select m.text from messages m where m.conversation_id = ${conversations.id} order by m.created_at desc limit 1)`,
            aiRuns: sql<number>`(select count(*) from agent_runs r where r.conversation_id = ${conversations.id})::int`,
            ruleHits: sql<number>`(select count(*) from automation_events e where e.conversation_id = ${conversations.id})::int`,
          })
          .from(conversations)
          .innerJoin(shops, eq(shops.id, conversations.shopId))
          .where(
            and(
              shopId ? eq(conversations.shopId, shopId) : undefined,
              filter === "needs_human" ? eq(conversations.needsHuman, true) : undefined,
              filter === "agent" || filter === "human" ? eq(conversations.mode, filter) : undefined,
            ),
          )
          .orderBy(desc(conversations.lastMessageAt))
          .limit(100);
      },
    );

    app.get("/conversations/:id", { schema: { params: idParams } }, async (req) => {
      const conv = await ctx.db.query.conversations.findFirst({ where: eq(conversations.id, req.params.id) });
      if (!conv) throw notFound("conversation");
      const [msgs, runs, events] = await Promise.all([
        ctx.db.select().from(messages).where(eq(messages.conversationId, conv.id)).orderBy(messages.createdAt).limit(300),
        ctx.db.select().from(agentRuns).where(eq(agentRuns.conversationId, conv.id)).orderBy(desc(agentRuns.createdAt)).limit(50),
        ctx.db
          .select({ event: automationEvents, ruleName: automationRules.name })
          .from(automationEvents)
          .leftJoin(automationRules, eq(automationRules.id, automationEvents.ruleId))
          .where(eq(automationEvents.conversationId, conv.id))
          .orderBy(desc(automationEvents.createdAt))
          .limit(50),
      ]);
      return { conversation: conv, messages: msgs, agentRuns: runs, automationEvents: events.map((e) => ({ ...e.event, ruleName: e.ruleName })) };
    });

    app.get("/agent-runs", { schema: { querystring: z.object({ shopId: z.string().uuid().optional(), onlyProblems: z.coerce.boolean().default(false) }) } }, async (req) =>
      ctx.db
        .select({ run: agentRuns, shopName: shops.name })
        .from(agentRuns)
        .innerJoin(shops, eq(shops.id, agentRuns.shopId))
        .where(
          and(
            req.query.shopId ? eq(agentRuns.shopId, req.query.shopId) : undefined,
            req.query.onlyProblems ? sql`(${agentRuns.handoff} is not null or ${agentRuns.error} is not null)` : undefined,
          ),
        )
        .orderBy(desc(agentRuns.createdAt))
        .limit(100),
    );

    app.get("/automation-events", { schema: { querystring: z.object({ shopId: z.string().uuid().optional() }) } }, async (req) =>
      ctx.db
        .select({ event: automationEvents, shopName: shops.name, ruleName: automationRules.name })
        .from(automationEvents)
        .innerJoin(shops, eq(shops.id, automationEvents.shopId))
        .leftJoin(automationRules, eq(automationRules.id, automationEvents.ruleId))
        .where(req.query.shopId ? eq(automationEvents.shopId, req.query.shopId) : undefined)
        .orderBy(desc(automationEvents.createdAt))
        .limit(100),
    );

    app.get("/fees", async () =>
      ctx.db
        .select({ shopId: shops.id, shopName: shops.name, volume: sql<number>`sum(${payments.amount})::bigint`, fees: sql<number>`sum(${payments.platformFee})::bigint`, n: sql<number>`count(*)::int` })
        .from(payments)
        .innerJoin(shops, eq(shops.id, payments.shopId))
        .where(and(eq(payments.status, "paid"), gte(payments.paidAt, since(30))))
        .groupBy(shops.id)
        .orderBy(sql`3 desc`),
    );
  };
