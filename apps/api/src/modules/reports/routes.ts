import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { appointments, conversations, customers, orderItems, orders, payments, services, staff, workingHours } from "@shopino/db";
import { BLOCKING_APPOINTMENT_STATUSES, addDaysIso, weekdayOfIso, zonedIsoDate, zonedToUtc } from "@shopino/shared";
import type { Ctx } from "../../lib/context";
import { requireShop } from "../../lib/auth";
import { lowStock } from "../catalog/service";

const params = z.object({ shopId: z.string().uuid() });
const PAID = sql`${orders.paymentStatus} = 'paid'`;

export const reportRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/:shopId/dashboard", { preHandler: requireShop(ctx), schema: { params } }, async (req) => {
      const shopId = req.shop.id;
      const tz = req.shop.timezone;
      const today = zonedIsoDate(new Date(), tz);
      const dayStart = zonedToUtc(today, 0, tz);
      const dayEnd = zonedToUtc(addDaysIso(today, 1), 0, tz);
      const weekStart = zonedToUtc(addDaysIso(today, -6), 0, tz);
      const monthAgo = new Date(Date.now() - 30 * 86400_000);
      const twoMonthsAgo = new Date(Date.now() - 60 * 86400_000);

      const [
        [revenue],
        [prevRevenue],
        [orderStats],
        [customerStats],
        [attention],
        [unanswered],
        [receipts],
        trend,
        recent,
        best,
        low,
        todayAppts,
        [apptRevenue],
      ] = await Promise.all([
        ctx.db
          .select({ total: sql<number>`coalesce(sum(${orders.total}), 0)::bigint`, n: sql<number>`count(*)::int` })
          .from(orders)
          .where(and(eq(orders.shopId, shopId), PAID, gte(orders.paidAt, monthAgo))),
        ctx.db
          .select({ total: sql<number>`coalesce(sum(${orders.total}), 0)::bigint` })
          .from(orders)
          .where(and(eq(orders.shopId, shopId), PAID, gte(orders.paidAt, twoMonthsAgo), lt(orders.paidAt, monthAgo))),
        ctx.db
          .select({
            total: sql<number>`count(*)::int`,
            completed: sql<number>`count(*) filter (where ${orders.status} in ('delivered','completed'))::int`,
          })
          .from(orders)
          .where(and(eq(orders.shopId, shopId), gte(orders.createdAt, monthAgo))),
        ctx.db
          .select({ total: sql<number>`count(*)::int`, fresh: sql<number>`count(*) filter (where ${customers.createdAt} >= ${monthAgo.toISOString()})::int` })
          .from(customers)
          .where(eq(customers.shopId, shopId)),
        ctx.db
          .select({
            readyToShip: sql<number>`count(*) filter (where ${orders.status} in ('confirmed','processing','ready_to_ship'))::int`,
            awaitingPayment: sql<number>`count(*) filter (where ${orders.status} = 'awaiting_payment')::int`,
          })
          .from(orders)
          .where(eq(orders.shopId, shopId)),
        ctx.db
          .select({ n: sql<number>`count(*)::int` })
          .from(conversations)
          .where(and(eq(conversations.shopId, shopId), sql`(${conversations.needsHuman} or ${conversations.unread} > 0)`)),
        ctx.db.select({ n: sql<number>`count(*)::int` }).from(payments).where(and(eq(payments.shopId, shopId), eq(payments.status, "pending_review"))),
        ctx.db
          .select({
            day: sql<string>`to_char(${orders.paidAt} at time zone ${tz}, 'YYYY-MM-DD')`,
            total: sql<number>`sum(${orders.total})::bigint`,
            n: sql<number>`count(*)::int`,
          })
          .from(orders)
          .where(and(eq(orders.shopId, shopId), PAID, gte(orders.paidAt, weekStart)))
          .groupBy(sql`1`),
        ctx.db
          .select({ id: orders.id, code: orders.code, total: orders.total, status: orders.status, createdAt: orders.createdAt, customerName: customers.name })
          .from(orders)
          .leftJoin(customers, eq(customers.id, orders.customerId))
          .where(eq(orders.shopId, shopId))
          .orderBy(desc(orders.createdAt))
          .limit(6),
        ctx.db
          .select({ title: orderItems.title, revenue: sql<number>`sum(${orderItems.total})::bigint`, sold: sql<number>`sum(${orderItems.quantity})::int` })
          .from(orderItems)
          .innerJoin(orders, eq(orders.id, orderItems.orderId))
          .where(and(eq(orders.shopId, shopId), PAID, gte(orders.paidAt, monthAgo)))
          .groupBy(orderItems.title)
          .orderBy(sql`2 desc`)
          .limit(5),
        lowStock(ctx.db, shopId, 6),
        ctx.db
          .select({
            id: appointments.id,
            startsAt: appointments.startsAt,
            endsAt: appointments.endsAt,
            status: appointments.status,
            serviceName: services.name,
            color: services.color,
            staffId: staff.id,
            staffName: staff.name,
            customerName: customers.name,
          })
          .from(appointments)
          .innerJoin(services, eq(services.id, appointments.serviceId))
          .innerJoin(staff, eq(staff.id, appointments.staffId))
          .innerJoin(customers, eq(customers.id, appointments.customerId))
          .where(and(eq(appointments.shopId, shopId), gte(appointments.startsAt, dayStart), lt(appointments.startsAt, dayEnd)))
          .orderBy(appointments.startsAt),
        ctx.db
          .select({ total: sql<number>`coalesce(sum(${appointments.price} - ${appointments.discountTotal}), 0)::bigint` })
          .from(appointments)
          .where(and(eq(appointments.shopId, shopId), eq(appointments.status, "completed"), gte(appointments.completedAt, monthAgo))),
      ]);

      // staff utilization today = booked minutes / working minutes
      const weekday = weekdayOfIso(today);
      const hours = await ctx.db
        .select({ staffId: workingHours.staffId, minutes: sql<number>`sum(${workingHours.endMin} - ${workingHours.startMin})::int` })
        .from(workingHours)
        .where(and(eq(workingHours.shopId, shopId), eq(workingHours.weekday, weekday)))
        .groupBy(workingHours.staffId);
      const booked = new Map<string, number>();
      for (const a of todayAppts) {
        if (!BLOCKING_APPOINTMENT_STATUSES.includes(a.status) && a.status !== "completed") continue;
        booked.set(a.staffId, (booked.get(a.staffId) ?? 0) + (a.endsAt.getTime() - a.startsAt.getTime()) / 60_000);
      }
      const utilization = hours.map((h) => ({ staffId: h.staffId, bookedMin: booked.get(h.staffId) ?? 0, workingMin: h.minutes }));

      const trendByDay = new Map(trend.map((t) => [t.day, t]));
      const week = Array.from({ length: 7 }, (_, i) => {
        const day = addDaysIso(today, i - 6);
        const t = trendByDay.get(day);
        return { day, total: Number(t?.total ?? 0), orders: t?.n ?? 0 };
      });

      const rev = Number(revenue?.total ?? 0);
      const prev = Number(prevRevenue?.total ?? 0);
      const pendingAppts = todayAppts.filter((a) => a.status === "pending").length;
      return {
        revenue: { total: rev + Number(apptRevenue?.total ?? 0), orders: rev, appointments: Number(apptRevenue?.total ?? 0), changePct: prev ? Math.round(((rev - prev) / prev) * 100) : null },
        orders: { total: orderStats?.total ?? 0, completed: orderStats?.completed ?? 0, avg: revenue?.n ? Math.round(rev / revenue.n) : 0 },
        customers: { total: customerStats?.total ?? 0, new: customerStats?.fresh ?? 0 },
        attention: {
          readyToShip: attention?.readyToShip ?? 0,
          awaitingPayment: attention?.awaitingPayment ?? 0,
          unansweredMessages: unanswered?.n ?? 0,
          receiptsToReview: receipts?.n ?? 0,
          lowStock: low.length,
          pendingAppointments: pendingAppts,
        },
        week,
        recentOrders: recent,
        bestSellers: best.map((b) => ({ ...b, revenue: Number(b.revenue) })),
        lowStock: low,
        today: { appointments: todayAppts, utilization },
      };
    });

    app.get(
      "/:shopId/reports/sales",
      { preHandler: requireShop(ctx), schema: { params, querystring: z.object({ from: z.coerce.date(), to: z.coerce.date() }) } },
      async (req) => {
        const tz = req.shop.timezone;
        const rows = await ctx.db
          .select({
            day: sql<string>`to_char(${orders.paidAt} at time zone ${tz}, 'YYYY-MM-DD')`,
            channel: orders.channel,
            total: sql<number>`sum(${orders.total})::bigint`,
            n: sql<number>`count(*)::int`,
          })
          .from(orders)
          .where(and(eq(orders.shopId, req.shop.id), PAID, gte(orders.paidAt, req.query.from), lt(orders.paidAt, req.query.to)))
          .groupBy(sql`1`, orders.channel)
          .orderBy(sql`1`);
        const appts = await ctx.db
          .select({ status: appointments.status, n: sql<number>`count(*)::int` })
          .from(appointments)
          .where(and(eq(appointments.shopId, req.shop.id), gte(appointments.startsAt, req.query.from), lt(appointments.startsAt, req.query.to)))
          .groupBy(appointments.status);
        return { sales: rows.map((r) => ({ ...r, total: Number(r.total) })), appointments: Object.fromEntries(appts.map((a) => [a.status, a.n])) };
      },
    );

    /** Who and what performed in a period: staff, services, products, channels, new customers. */
    app.get(
      "/:shopId/reports/performance",
      { preHandler: requireShop(ctx), schema: { params, querystring: z.object({ from: z.coerce.date(), to: z.coerce.date() }) } },
      async (req) => {
        const { from, to } = req.query;
        const shopId = req.shop.id;
        const inRange = and(eq(appointments.shopId, shopId), gte(appointments.startsAt, from), lt(appointments.startsAt, to));
        const paidOrders = and(eq(orders.shopId, shopId), PAID, gte(orders.paidAt, from), lt(orders.paidAt, to));
        const done = sql`${appointments.status} = 'completed'`;
        const [staffRows, serviceRows, productRows, orderChannels, apptChannels, statusRows, [fresh]] = await Promise.all([
          ctx.db
            .select({
              id: staff.id,
              name: staff.name,
              color: staff.color,
              total: sql<number>`count(*)::int`,
              completed: sql<number>`count(*) filter (where ${done})::int`,
              noShow: sql<number>`count(*) filter (where ${appointments.status} = 'no_show')::int`,
              cancelled: sql<number>`count(*) filter (where ${appointments.status} = 'cancelled')::int`,
              revenue: sql<number>`coalesce(sum(${appointments.price} - ${appointments.discountTotal}) filter (where ${done}), 0)::bigint`,
              minutes: sql<number>`coalesce(sum(extract(epoch from ${appointments.endsAt} - ${appointments.startsAt}) / 60) filter (where ${done}), 0)::int`,
            })
            .from(appointments)
            .innerJoin(staff, eq(staff.id, appointments.staffId))
            .where(inRange)
            .groupBy(staff.id),
          ctx.db
            .select({
              id: services.id,
              name: services.name,
              color: services.color,
              completed: sql<number>`count(*) filter (where ${done})::int`,
              revenue: sql<number>`coalesce(sum(${appointments.price} - ${appointments.discountTotal}) filter (where ${done}), 0)::bigint`,
            })
            .from(appointments)
            .innerJoin(services, eq(services.id, appointments.serviceId))
            .where(inRange)
            .groupBy(services.id)
            .orderBy(sql`5 desc`),
          ctx.db
            .select({ title: orderItems.title, sold: sql<number>`sum(${orderItems.quantity})::int`, revenue: sql<number>`sum(${orderItems.total})::bigint` })
            .from(orderItems)
            .innerJoin(orders, eq(orders.id, orderItems.orderId))
            .where(paidOrders)
            .groupBy(orderItems.title)
            .orderBy(sql`3 desc`)
            .limit(10),
          ctx.db
            .select({ channel: orders.channel, n: sql<number>`count(*)::int`, total: sql<number>`sum(${orders.total})::bigint` })
            .from(orders)
            .where(paidOrders)
            .groupBy(orders.channel),
          ctx.db
            .select({ channel: appointments.channel, n: sql<number>`count(*)::int` })
            .from(appointments)
            .where(and(inRange, sql`${appointments.status} <> 'cancelled'`))
            .groupBy(appointments.channel),
          ctx.db.select({ status: appointments.status, n: sql<number>`count(*)::int` }).from(appointments).where(inRange).groupBy(appointments.status),
          ctx.db
            .select({ n: sql<number>`count(*)::int` })
            .from(customers)
            .where(and(eq(customers.shopId, shopId), gte(customers.createdAt, from), lt(customers.createdAt, to))),
        ]);
        const n = (v: unknown) => Number(v ?? 0);
        return {
          staff: staffRows.map((s) => ({ ...s, revenue: n(s.revenue) })).sort((a, b) => b.revenue - a.revenue),
          services: serviceRows.map((s) => ({ ...s, revenue: n(s.revenue) })),
          products: productRows.map((p) => ({ ...p, revenue: n(p.revenue) })),
          orderChannels: orderChannels.map((c) => ({ ...c, total: n(c.total) })),
          appointmentChannels: apptChannels,
          appointmentStatus: Object.fromEntries(statusRows.map((s) => [s.status, s.n])),
          newCustomers: fresh?.n ?? 0,
        };
      },
    );

  };
