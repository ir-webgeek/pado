import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { appointments, customers, loyaltyLedger, orders, services } from "@shopino/db";
import { CUSTOMER_SEGMENTS } from "@shopino/shared";
import type { Ctx } from "../../lib/context";
import { requireShop } from "../../lib/auth";
import { notFound } from "../../lib/errors";
import { changePoints, upsertCustomer } from "./service";
import { vipProgress } from "./segments";

const params = z.object({ shopId: z.string().uuid() });
const withId = params.extend({ id: z.string().uuid() });

export const customerRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/:shopId/customers",
      {
        preHandler: requireShop(ctx),
        schema: {
          params,
          querystring: z.object({
            segment: z.enum(CUSTOMER_SEGMENTS).optional(),
            q: z.string().optional(),
            sort: z.enum(["recent", "spent", "inactive"]).default("recent"),
            limit: z.coerce.number().int().min(1).max(100).default(30),
            offset: z.coerce.number().int().min(0).default(0),
          }),
        },
      },
      async (req) => {
        const { segment, q, sort, limit, offset } = req.query;
        const where = and(
          eq(customers.shopId, req.shop.id),
          segment ? eq(customers.segment, segment) : undefined,
          q ? or(ilike(customers.name, `%${q}%`), ilike(customers.phone, `%${q}%`), ilike(customers.instagramUsername, `%${q}%`)) : undefined,
        );
        const order =
          sort === "spent"
            ? [desc(customers.totalSpent)]
            : sort === "inactive"
              ? [sql`greatest(${customers.lastOrderAt}, ${customers.lastVisitAt}) asc nulls last`, desc(customers.totalSpent)]
              : [desc(customers.createdAt)];
        const [items, counts] = await Promise.all([
          ctx.db.select().from(customers).where(where).orderBy(...order).limit(limit).offset(offset),
          ctx.db.select({ segment: customers.segment, n: sql<number>`count(*)::int` }).from(customers).where(eq(customers.shopId, req.shop.id)).groupBy(customers.segment),
        ]);
        return { items, counts: Object.fromEntries(counts.map((c) => [c.segment, c.n])), vipRule: req.shop.settings.vipRule };
      },
    );

    // customers close to VIP - one nudge (SMS/discount) usually tips them over
    app.get("/:shopId/customers/near-vip", { preHandler: requireShop(ctx), schema: { params } }, async (req) => {
      const rows = await ctx.db
        .select()
        .from(customers)
        .where(and(eq(customers.shopId, req.shop.id), sql`${customers.segment} <> 'vip'`, sql`${customers.ordersCount} + ${customers.appointmentsCount} > 0`))
        .orderBy(desc(customers.totalSpent))
        .limit(200);
      return rows
        .map((c) => ({ ...c, vipProgress: vipProgress(c, req.shop.settings) }))
        .filter((c) => c.vipProgress >= 0.6)
        .sort((a, b) => b.vipProgress - a.vipProgress)
        .slice(0, 30);
    });

    app.get("/:shopId/customers/:id", { preHandler: requireShop(ctx), schema: { params: withId } }, async (req) => {
      const c = await ctx.db.query.customers.findFirst({ where: and(eq(customers.id, req.params.id), eq(customers.shopId, req.shop.id)) });
      if (!c) throw notFound("customer");
      const [recentOrders, visits, points] = await Promise.all([
        ctx.db.select().from(orders).where(eq(orders.customerId, c.id)).orderBy(desc(orders.createdAt)).limit(20),
        ctx.db
          .select({ appt: appointments, serviceName: services.name })
          .from(appointments)
          .innerJoin(services, eq(services.id, appointments.serviceId))
          .where(eq(appointments.customerId, c.id))
          .orderBy(desc(appointments.startsAt))
          .limit(20),
        ctx.db.select().from(loyaltyLedger).where(eq(loyaltyLedger.customerId, c.id)).orderBy(desc(loyaltyLedger.createdAt)).limit(30),
      ]);
      return {
        customer: { ...c, vipProgress: vipProgress(c, req.shop.settings) },
        orders: recentOrders,
        appointments: visits.map((v) => ({ ...v.appt, serviceName: v.serviceName })),
        points,
      };
    });

    app.post(
      "/:shopId/customers",
      { preHandler: requireShop(ctx, "staff"), schema: { params, body: z.object({ phone: z.string(), name: z.string().max(80).optional(), instagramUsername: z.string().max(60).optional() }) } },
      async (req) => upsertCustomer(ctx.db, req.shop.id, req.body),
    );

    app.patch(
      "/:shopId/customers/:id",
      {
        preHandler: requireShop(ctx, "staff"),
        schema: { params: withId, body: z.object({ name: z.string().max(80).optional(), notes: z.string().max(2000).optional(), tags: z.array(z.string().max(30)).max(20).optional(), smsOptOut: z.boolean().optional() }) },
      },
      async (req) => {
        const [row] = await ctx.db.update(customers).set(req.body).where(and(eq(customers.id, req.params.id), eq(customers.shopId, req.shop.id))).returning();
        if (!row) throw notFound("customer");
        return row;
      },
    );

    app.post(
      "/:shopId/customers/:id/points",
      { preHandler: requireShop(ctx, "admin"), schema: { params: withId, body: z.object({ delta: z.number().int().min(-100000).max(100000), note: z.string().max(200).optional() }) } },
      async (req) => {
        const c = await ctx.db.query.customers.findFirst({ where: and(eq(customers.id, req.params.id), eq(customers.shopId, req.shop.id)) });
        if (!c) throw notFound("customer");
        const points = await changePoints(ctx.db, req.shop.id, c.id, req.body.delta, "adjust", { type: "manual", id: req.user.sub });
        return { points };
      },
    );
  };
