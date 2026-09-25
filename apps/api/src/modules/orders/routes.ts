import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { customers, orders, payments } from "@shopino/db";
import { ORDER_STATUSES, createOrderSchema, orderStatusUpdateSchema } from "@shopino/shared";
import type { Ctx } from "../../lib/context";
import { requireShop } from "../../lib/auth";
import { createOrder, getOrderFull, transitionOrder } from "./service";
import { reviewReceipt } from "../payments/service";
import { env } from "../../config";

const params = z.object({ shopId: z.string().uuid() });
const withId = params.extend({ id: z.string().uuid() });

export const orderRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/:shopId/orders",
      {
        preHandler: requireShop(ctx),
        schema: {
          params,
          querystring: z.object({
            status: z.enum(ORDER_STATUSES).optional(),
            q: z.string().optional(),
            limit: z.coerce.number().int().min(1).max(100).default(30),
            offset: z.coerce.number().int().min(0).default(0),
          }),
        },
      },
      async (req) => {
        const { status, q, limit, offset } = req.query;
        const where = and(
          eq(orders.shopId, req.shop.id),
          status ? eq(orders.status, status) : undefined,
          q ? or(ilike(orders.code, `%${q}%`), ilike(customers.name, `%${q}%`), ilike(customers.phone, `%${q}%`)) : undefined,
        );
        const [items, counts] = await Promise.all([
          ctx.db
            .select({
              order: orders,
              customer: { id: customers.id, name: customers.name, phone: customers.phone, city: customers.city },
              items: sql<{ title: string; variantLabel: string; quantity: number }[]>`(
                select coalesce(json_agg(json_build_object('title', oi.title, 'variantLabel', oi.variant_label, 'quantity', oi.quantity)), '[]'::json)
                from order_items oi where oi.order_id = ${orders.id})`,
            })
            .from(orders)
            .leftJoin(customers, eq(customers.id, orders.customerId))
            .where(where)
            .orderBy(desc(orders.createdAt))
            .limit(limit)
            .offset(offset),
          ctx.db
            .select({ status: orders.status, n: sql<number>`count(*)::int` })
            .from(orders)
            .where(eq(orders.shopId, req.shop.id))
            .groupBy(orders.status),
        ]);
        return {
          items: items.map((r) => ({ ...r.order, customer: r.customer?.id ? r.customer : null, items: r.items })),
          counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
        };
      },
    );

    app.get("/:shopId/orders/:id", { preHandler: requireShop(ctx), schema: { params: withId } }, async (req) => {
      const order = await getOrderFull(ctx.db, { shopId: req.shop.id, id: req.params.id });
      const pays = await ctx.db.select().from(payments).where(eq(payments.orderId, order.id)).orderBy(desc(payments.createdAt));
      return { ...order, payments: pays, link: `${env.PUBLIC_WEB_URL}/o/${order.code}?t=${order.accessToken}` };
    });

    // manual order (phone / in-person / DM typed by staff)
    app.post("/:shopId/orders", { preHandler: requireShop(ctx, "staff"), schema: { params, body: createOrderSchema } }, async (req) => {
      const order = await createOrder(ctx.db, ctx.queues, req.shop.id, req.body, { type: "user", id: req.user.sub });
      return { ...order, link: `${env.PUBLIC_WEB_URL}/o/${order.code}?t=${order.accessToken}` };
    });

    app.post("/:shopId/orders/:id/status", { preHandler: requireShop(ctx, "staff"), schema: { params: withId, body: orderStatusUpdateSchema } }, async (req) => {
      const { status, ...extra } = req.body;
      const order = await transitionOrder(ctx.db, req.shop.id, req.params.id, status, { type: "user", id: req.user.sub }, extra);
      if (status === "shipped") await ctx.queues.add("notify.order-shipped", { orderId: order.id });
      if (status === "confirmed") await ctx.queues.add("notify.order-paid", { orderId: order.id });
      return order;
    });

    app.post("/:shopId/orders/:id/extend", { preHandler: requireShop(ctx, "staff"), schema: { params: withId, body: z.object({ hours: z.number().int().min(1).max(168) }) } }, async (req) => {
      const until = new Date(Date.now() + req.body.hours * 3600_000);
      const [o] = await ctx.db
        .update(orders)
        .set({ reservedUntil: until })
        .where(and(eq(orders.id, req.params.id), eq(orders.shopId, req.shop.id), eq(orders.status, "awaiting_payment")))
        .returning();
      if (o) await ctx.queues.at("order.expire", { orderId: o.id }, until, `order-expire-${o.id}-${until.getTime()}`);
      return { reservedUntil: until };
    });

    app.post("/:shopId/orders/:id/printed", { preHandler: requireShop(ctx, "staff"), schema: { params: withId } }, async (req) => {
      await ctx.db.update(orders).set({ printedAt: new Date() }).where(and(eq(orders.id, req.params.id), eq(orders.shopId, req.shop.id)));
      return { ok: true };
    });

    // ---- payments needing review (card-to-card receipts)
    app.get("/:shopId/payments/pending", { preHandler: requireShop(ctx, "staff"), schema: { params } }, async (req) =>
      ctx.db
        .select()
        .from(payments)
        .where(and(eq(payments.shopId, req.shop.id), eq(payments.status, "pending_review")))
        .orderBy(desc(payments.createdAt)),
    );
    app.post(
      "/:shopId/payments/:id/review",
      { preHandler: requireShop(ctx, "admin"), schema: { params: withId, body: z.object({ approve: z.boolean() }) } },
      async (req) => reviewReceipt(ctx.db, ctx.queues, req.shop.id, req.params.id, req.body.approve),
    );
  };
