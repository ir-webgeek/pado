import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, desc, eq, gte, inArray, isNotNull, lt, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { appointments, customers, expenses, orderItems, orders, payments, walletTransactions } from "@shopino/db";
import { expenseInputSchema } from "@shopino/shared";
import type { Ctx } from "../../lib/context";
import { audit } from "../../lib/audit";
import { requireShop } from "../../lib/auth";
import { badRequest, notFound } from "../../lib/errors";

const params = z.object({ shopId: z.string().uuid() });
const withId = params.extend({ id: z.string().uuid() });
const rangeQuery = z.object({ from: z.coerce.date(), to: z.coerce.date() });
const MAX_RANGE_DAYS = 400;

export const financeRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/:shopId/expenses", { preHandler: requireShop(ctx, "admin"), schema: { params, querystring: rangeQuery } }, async (req) =>
      ctx.db
        .select()
        .from(expenses)
        .where(and(eq(expenses.shopId, req.shop.id), gte(expenses.spentAt, req.query.from), lt(expenses.spentAt, req.query.to)))
        .orderBy(desc(expenses.spentAt))
        .limit(500),
    );

    app.post("/:shopId/expenses", { preHandler: requireShop(ctx, "admin"), schema: { params, body: expenseInputSchema } }, async (req) => {
      const [row] = await ctx.db.insert(expenses).values({ ...req.body, shopId: req.shop.id, createdBy: req.user.sub }).returning();
      await audit(ctx.db, req.shop.id, { type: "user", id: req.user.sub }, "expense.create", "expense", row!.id, req.body);
      return row;
    });

    app.delete("/:shopId/expenses/:id", { preHandler: requireShop(ctx, "admin"), schema: { params: withId } }, async (req) => {
      const [row] = await ctx.db.delete(expenses).where(and(eq(expenses.id, req.params.id), eq(expenses.shopId, req.shop.id))).returning();
      if (!row) throw notFound("expense");
      await audit(ctx.db, req.shop.id, { type: "user", id: req.user.sub }, "expense.delete", "expense", row.id, { amount: row.amount, category: row.category });
      return { ok: true };
    });

    /**
     * Profit and loss for a period. Sales are recognised when earned: paid orders that were not
     * cancelled or returned, completed bookings, and deposits the shop kept on cancellation.
     */
    app.get("/:shopId/reports/finance", { preHandler: requireShop(ctx, "admin"), schema: { params, querystring: rangeQuery } }, async (req) => {
      const { from, to } = req.query;
      if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86400_000 || to <= from) throw badRequest("invalid_range");
      const shopId = req.shop.id;
      const tz = req.shop.timezone;
      const orderWhere = and(
        eq(orders.shopId, shopId),
        eq(orders.paymentStatus, "paid"),
        notInArray(orders.status, ["cancelled", "returned"]),
        gte(orders.paidAt, from),
        lt(orders.paidAt, to),
      );
      // imported or legacy rows may lack completedAt; they count at their end time
      const doneAt = sql`coalesce(${appointments.completedAt}, ${appointments.endsAt})`;
      const apptDone = and(eq(appointments.shopId, shopId), eq(appointments.status, "completed"), sql`${doneAt} >= ${from.toISOString()}`, sql`${doneAt} < ${to.toISOString()}`);
      const kept = and(eq(appointments.shopId, shopId), eq(appointments.refundStatus, "kept"), gte(appointments.cancelledAt, from), lt(appointments.cancelledAt, to));
      const day = (col: unknown) => sql<string>`to_char(${col} at time zone ${tz}, 'YYYY-MM-DD')`;

      const [[orderSales], [cogs], [serviceSales], [keptDeposits], expenseRows, platformRows, [liability], cashRows, orderDaily, serviceDaily, expenseDaily] = await Promise.all([
        ctx.db
          .select({ n: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${orders.total}), 0)::bigint`, shipping: sql<number>`coalesce(sum(${orders.shippingTotal}), 0)::bigint` })
          .from(orders)
          .where(orderWhere),
        ctx.db
          .select({
            cost: sql<number>`coalesce(sum(${orderItems.quantity} * ${orderItems.unitCost}), 0)::bigint`,
            missing: sql<number>`count(*) filter (where ${orderItems.unitCost} is null and ${orderItems.variantId} is not null)::int`,
          })
          .from(orderItems)
          .innerJoin(orders, eq(orders.id, orderItems.orderId))
          .where(orderWhere),
        ctx.db
          .select({ n: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${appointments.price} - ${appointments.discountTotal}), 0)::bigint` })
          .from(appointments)
          .where(apptDone),
        ctx.db.select({ total: sql<number>`coalesce(sum(${appointments.paidAmount}), 0)::bigint` }).from(appointments).where(kept),
        ctx.db
          .select({ category: expenses.category, total: sql<number>`sum(${expenses.amount})::bigint` })
          .from(expenses)
          .where(and(eq(expenses.shopId, shopId), gte(expenses.spentAt, from), lt(expenses.spentAt, to)))
          .groupBy(expenses.category),
        ctx.db
          .select({ kind: walletTransactions.kind, total: sql<number>`(-sum(${walletTransactions.amount}))::bigint` })
          .from(walletTransactions)
          .where(
            and(
              eq(walletTransactions.shopId, shopId),
              inArray(walletTransactions.kind, ["ai_usage", "sms"]),
              lt(walletTransactions.amount, 0),
              gte(walletTransactions.createdAt, from),
              lt(walletTransactions.createdAt, to),
            ),
          )
          .groupBy(walletTransactions.kind),
        ctx.db.select({ total: sql<number>`coalesce(sum(${customers.walletBalance}), 0)::bigint` }).from(customers).where(eq(customers.shopId, shopId)),
        ctx.db
          .select({ method: payments.method, total: sql<number>`sum(${payments.amount})::bigint`, n: sql<number>`count(*)::int` })
          .from(payments)
          .where(and(eq(payments.shopId, shopId), eq(payments.status, "paid"), isNotNull(payments.paidAt), gte(payments.paidAt, from), lt(payments.paidAt, to), sql`${payments.purpose} <> 'wallet_topup'`))
          .groupBy(payments.method),
        ctx.db.select({ day: day(orders.paidAt), total: sql<number>`sum(${orders.total})::bigint` }).from(orders).where(orderWhere).groupBy(sql`1`),
        ctx.db.select({ day: day(doneAt), total: sql<number>`sum(${appointments.price} - ${appointments.discountTotal})::bigint` }).from(appointments).where(apptDone).groupBy(sql`1`),
        ctx.db
          .select({ day: day(expenses.spentAt), total: sql<number>`sum(${expenses.amount})::bigint` })
          .from(expenses)
          .where(and(eq(expenses.shopId, shopId), gte(expenses.spentAt, from), lt(expenses.spentAt, to)))
          .groupBy(sql`1`),
      ]);

      const n = (v: unknown) => Number(v ?? 0);
      const revenue = { orders: n(orderSales?.total), services: n(serviceSales?.total), keptDeposits: n(keptDeposits?.total) };
      const revenueTotal = revenue.orders + revenue.services + revenue.keptDeposits;
      const cogsTotal = n(cogs?.cost);
      const expenseTotal = expenseRows.reduce((s, r) => s + n(r.total), 0);
      const platformTotal = platformRows.reduce((s, r) => s + n(r.total), 0);
      const grossProfit = revenueTotal - cogsTotal;

      const daily = new Map<string, { income: number; expenses: number }>();
      const bump = (d: string, k: "income" | "expenses", v: number) => daily.set(d, { income: 0, expenses: 0, ...daily.get(d), [k]: (daily.get(d)?.[k] ?? 0) + v });
      for (const r of orderDaily) bump(r.day, "income", n(r.total));
      for (const r of serviceDaily) bump(r.day, "income", n(r.total));
      for (const r of expenseDaily) bump(r.day, "expenses", n(r.total));

      return {
        revenue: { ...revenue, total: revenueTotal, orderCount: orderSales?.n ?? 0, serviceCount: serviceSales?.n ?? 0, shipping: n(orderSales?.shipping) },
        cogs: { total: cogsTotal, itemsMissingCost: cogs?.missing ?? 0 },
        grossProfit,
        expenses: { total: expenseTotal, byCategory: expenseRows.map((r) => ({ category: r.category, total: n(r.total) })).sort((a, b) => b.total - a.total) },
        platform: { total: platformTotal, byKind: platformRows.map((r) => ({ kind: r.kind, total: n(r.total) })) },
        netProfit: grossProfit - expenseTotal - platformTotal,
        cashIn: cashRows.map((r) => ({ method: r.method, total: n(r.total), count: r.n })),
        customerWalletLiability: n(liability?.total),
        daily: [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ day: d, ...v })),
      };
    });
  };
