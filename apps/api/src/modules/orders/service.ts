import { and, eq, inArray, lt, sql } from "drizzle-orm";
import {
  orderEvents,
  orderItems,
  orders,
  productVariants,
  products,
  shippingMethods,
  shops,
  resolveShopSettings,
  type Address,
  type Database,
  type DbOrTx,
  type Tx,
} from "@shopino/db";
import { ORDER_TRANSITIONS, PLANS, orderCode, type CreateOrderInput, type OrderStatus, type PaymentMethod } from "@shopino/shared";
import type { Actor } from "../../lib/audit";
import type { Queues } from "../../lib/queues";
import { randomToken } from "../../lib/crypto";
import { badRequest, conflict, notFound, paymentRequired } from "../../lib/errors";
import { changePoints, recordPurchase, reversePurchase, upsertCustomer } from "../customers/service";
import { consumeDiscount, evaluateDiscount } from "../discounts/service";
import { variantLabel } from "../catalog/service";

async function event(db: DbOrTx, orderId: string, type: string, actor: Actor, data?: unknown) {
  await db.insert(orderEvents).values({ orderId, type, actorType: actor.type, actorId: actor.id ?? null, data: data ?? null });
}

async function assertMonthlyOrderLimit(db: DbOrTx, shopId: string) {
  const shop = await db.query.shops.findFirst({ where: eq(shops.id, shopId), columns: { plan: true } });
  const limit = shop ? PLANS[shop.plan].limits.ordersPerMonth : null;
  if (limit === null) return;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.shopId, shopId), sql`${orders.createdAt} >= date_trunc('month', now())`));
  if ((row?.n ?? 0) >= limit) throw paymentRequired("plan_limit_orders", `your plan allows ${limit} orders per month`);
}

/**
 * Create an order and reserve stock. Rows are locked in a stable order (by id) to avoid deadlocks
 * between concurrent checkouts touching the same variants.
 */
export async function createOrder(db: Database, queues: Queues, shopId: string, input: CreateOrderInput, actor: Actor, conversationId?: string) {
  const order = await db.transaction(async (tx) => {
    await assertMonthlyOrderLimit(tx, shopId);
    const qty = new Map<string, number>();
    for (const it of input.items) qty.set(it.variantId, (qty.get(it.variantId) ?? 0) + it.quantity);
    const ids = [...qty.keys()].sort();

    const locked = await tx
      .select({ v: productVariants, title: products.title, status: products.status })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(productVariants.shopId, shopId), inArray(productVariants.id, ids)))
      .orderBy(productVariants.id)
      .for("update", { of: productVariants });
    if (locked.length !== ids.length) throw badRequest("invalid_items", "some items are not available");

    let subtotal = 0;
    const lines = locked.map(({ v, title, status }) => {
      const q = qty.get(v.id)!;
      if (status !== "active") throw conflict("product_unavailable", `${title} is not available`);
      if (v.stock - v.reserved < q) throw conflict("out_of_stock", `${title} ${variantLabel(v.attributes)} - only ${Math.max(0, v.stock - v.reserved)} left`);
      subtotal += v.price * q;
      return { v, title, q };
    });

    let discountTotal = 0;
    if (input.discountCode) discountTotal = (await evaluateDiscount(tx, shopId, input.discountCode, subtotal, "orders")).amount;

    const customer = input.customer ? await upsertCustomer(tx, shopId, input.customer) : null;
    const [o] = await tx
      .insert(orders)
      .values({
        shopId,
        code: orderCode(),
        accessToken: randomToken(18),
        customerId: customer?.id ?? null,
        channel: input.channel,
        subtotal,
        discountTotal,
        total: subtotal - discountTotal,
        discountCode: input.discountCode?.toUpperCase(),
        note: input.note,
        reservedUntil: new Date(Date.now() + input.reserveMinutes * 60_000),
        conversationId: conversationId ?? null,
      })
      .returning();

    await tx.insert(orderItems).values(
      lines.map(({ v, title, q }) => ({
        orderId: o!.id,
        productId: v.productId,
        variantId: v.id,
        title,
        variantLabel: variantLabel(v.attributes),
        unitPrice: v.price,
        quantity: q,
        total: v.price * q,
      })),
    );
    for (const { v, q } of lines) {
      await tx.update(productVariants).set({ reserved: sql`${productVariants.reserved} + ${q}` }).where(eq(productVariants.id, v.id));
    }
    await event(tx, o!.id, "created", actor, { channel: input.channel, items: lines.length });
    return o!;
  });

  await queues.at("order.expire", { orderId: order.id }, order.reservedUntil!, `order-expire-${order.id}`);
  return order;
}

export async function getOrderFull(db: DbOrTx, where: { shopId?: string; id?: string; code?: string }) {
  const conds = [];
  if (where.shopId) conds.push(eq(orders.shopId, where.shopId));
  if (where.id) conds.push(eq(orders.id, where.id));
  if (where.code) conds.push(eq(orders.code, where.code));
  const o = await db.query.orders.findFirst({ where: and(...conds) });
  if (!o) throw notFound("order");
  const [items, events, customer] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, o.id)),
    db.select().from(orderEvents).where(eq(orderEvents.orderId, o.id)).orderBy(orderEvents.createdAt),
    o.customerId ? db.query.customers.findFirst({ where: (c, { eq }) => eq(c.id, o.customerId!) }) : Promise.resolve(undefined),
  ]);
  return { ...o, items, events, customer: customer ?? null };
}

/** Customer fills address, picks shipping and payment method; totals are recomputed server-side. */
export async function prepareCheckout(
  tx: Tx,
  orderId: string,
  input: { address: Address; paymentMethod: PaymentMethod; shippingMethodId?: string; usePoints: number },
) {
  const o = await tx.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!o) throw notFound("order");
  if (o.status !== "awaiting_payment") throw conflict("order_not_payable", "this order is no longer awaiting payment");
  if (o.reservedUntil && o.reservedUntil < new Date()) throw conflict("order_expired", "reservation expired");

  const shop = await tx.query.shops.findFirst({ where: eq(shops.id, o.shopId) });
  const settings = resolveShopSettings(shop!.settings);

  let shippingTotal = 0;
  if (input.shippingMethodId) {
    const m = await tx.query.shippingMethods.findFirst({
      where: and(eq(shippingMethods.id, input.shippingMethodId), eq(shippingMethods.shopId, o.shopId), eq(shippingMethods.active, true)),
    });
    if (!m) throw badRequest("invalid_shipping_method");
    shippingTotal = m.freeOver !== null && o.subtotal - o.discountTotal >= m.freeOver ? 0 : m.price;
  }

  let customerId = o.customerId;
  if (!customerId) {
    const c = await upsertCustomer(tx, o.shopId, { phone: input.address.phone, name: input.address.fullName });
    customerId = c?.id ?? null;
  }

  let pointsUsed = 0;
  let pointsDiscount = 0;
  if (input.usePoints > 0 && customerId && settings.loyalty.enabled) {
    const c = await tx.query.customers.findFirst({ where: (t, { eq }) => eq(t.id, customerId!) });
    const maxByValue = Math.floor((o.subtotal - o.discountTotal) / Math.max(1, settings.loyalty.pointValue));
    pointsUsed = Math.min(input.usePoints, c?.points ?? 0, maxByValue);
    pointsDiscount = pointsUsed * settings.loyalty.pointValue;
  }

  const total = Math.max(0, o.subtotal - o.discountTotal - pointsDiscount + shippingTotal);
  const [updated] = await tx
    .update(orders)
    .set({
      address: input.address,
      customerId,
      paymentMethod: input.paymentMethod,
      shippingMethodId: input.shippingMethodId ?? null,
      shippingTotal,
      pointsUsed,
      pointsDiscount,
      total,
    })
    .where(eq(orders.id, o.id))
    .returning();
  return { order: updated!, settings, shop: shop! };
}

/** Payment confirmed: deduct stock, record purchase, redeem points, consume discount. Idempotent. */
export async function markOrderPaid(tx: Tx, orderId: string, actor: Actor, meta: { method: PaymentMethod; refId?: string }) {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!o) throw notFound("order");
  if (o.paymentStatus === "paid") return { order: o, alreadyPaid: true };
  if (!["awaiting_payment", "expired"].includes(o.status)) throw conflict("order_not_payable");

  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, o.id));
  const wasExpired = o.status === "expired";
  for (const it of items) {
    if (!it.variantId) continue;
    // an expired order already released its reservation; take stock directly and fail loudly if gone
    const [row] = await tx
      .update(productVariants)
      .set(
        wasExpired
          ? { stock: sql`${productVariants.stock} - ${it.quantity}` }
          : { stock: sql`${productVariants.stock} - ${it.quantity}`, reserved: sql`greatest(${productVariants.reserved} - ${it.quantity}, 0)` },
      )
      .where(
        and(
          eq(productVariants.id, it.variantId),
          // the reservation already guarantees availability; an expired order must re-check free stock
          wasExpired ? sql`${productVariants.stock} - ${it.quantity} >= ${productVariants.reserved}` : undefined,
        ),
      )
      .returning({ stock: productVariants.stock });
    if (!row) throw conflict("out_of_stock", `${it.title} is out of stock`);
    await tx.execute(
      sql`INSERT INTO inventory_movements (shop_id, variant_id, delta, stock_after, reason, ref_type, ref_id) VALUES (${o.shopId}, ${it.variantId}, ${-it.quantity}, ${row.stock}, 'sale', 'order', ${o.id})`,
    );
  }

  const [paid] = await tx
    .update(orders)
    .set({ status: "confirmed", paymentStatus: "paid", paymentMethod: meta.method, paidAt: new Date(), reservedUntil: null })
    .where(eq(orders.id, o.id))
    .returning();

  const shop = await tx.query.shops.findFirst({ where: eq(shops.id, o.shopId) });
  const settings = resolveShopSettings(shop!.settings);
  if (o.customerId) {
    if (o.pointsUsed > 0) await changePoints(tx, o.shopId, o.customerId, -o.pointsUsed, "redeem", { type: "order", id: o.id });
    await recordPurchase(tx, o.shopId, o.customerId, o.total, settings, { type: "order", id: o.id });
  }
  if (o.discountCode) await consumeDiscount(tx, o.shopId, o.discountCode);
  await event(tx, o.id, "paid", actor, meta);
  return { order: paid!, alreadyPaid: false };
}

/** Releases reservations (unpaid) or restocks and reverses the purchase (paid). */
export async function cancelOrder(tx: Tx, orderId: string, actor: Actor, reason = "cancelled", finalStatus: OrderStatus = "cancelled") {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!o) throw notFound("order");
  if (["cancelled", "expired", "returned"].includes(o.status)) return o;

  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, o.id));
  for (const it of items) {
    if (!it.variantId) continue;
    if (o.paymentStatus === "paid") {
      const [row] = await tx
        .update(productVariants)
        .set({ stock: sql`${productVariants.stock} + ${it.quantity}` })
        .where(eq(productVariants.id, it.variantId))
        .returning({ stock: productVariants.stock });
      if (row) {
        await tx.execute(
          sql`INSERT INTO inventory_movements (shop_id, variant_id, delta, stock_after, reason, ref_type, ref_id) VALUES (${o.shopId}, ${it.variantId}, ${it.quantity}, ${row.stock}, ${finalStatus === "returned" ? "return" : "cancel"}, 'order', ${o.id})`,
        );
      }
    } else if (o.status === "awaiting_payment") {
      await tx
        .update(productVariants)
        .set({ reserved: sql`greatest(${productVariants.reserved} - ${it.quantity}, 0)` })
        .where(eq(productVariants.id, it.variantId));
    }
  }
  if (o.paymentStatus === "paid" && o.customerId) await reversePurchase(tx, o.shopId, o.customerId, o.total, { type: "order", id: o.id });

  const [updated] = await tx
    .update(orders)
    .set({
      status: finalStatus,
      cancelledAt: new Date(),
      reservedUntil: null,
      paymentStatus: o.paymentStatus === "paid" ? "refunded" : o.paymentStatus,
    })
    .where(eq(orders.id, o.id))
    .returning();
  await event(tx, o.id, finalStatus, actor, { reason });
  return updated!;
}

export async function transitionOrder(
  db: Database,
  shopId: string,
  orderId: string,
  to: OrderStatus,
  actor: Actor,
  extra: { trackingCode?: string; carrier?: string; note?: string } = {},
) {
  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.shopId, shopId))).for("update");
    if (!o) throw notFound("order");
    if (!ORDER_TRANSITIONS[o.status].includes(to)) throw conflict("invalid_transition", `cannot move from ${o.status} to ${to}`);
    if (to === "confirmed" && o.paymentStatus !== "paid") {
      // manual confirmation of an unpaid order = cash / offline payment
      const { order } = await markOrderPaid(tx, o.id, actor, { method: "cash" });
      return order;
    }
    if (to === "cancelled" || to === "returned" || to === "expired") return cancelOrder(tx, o.id, actor, extra.note, to);

    const now = new Date();
    const [updated] = await tx
      .update(orders)
      .set({
        status: to,
        ...(to === "shipped" ? { shippedAt: now, trackingCode: extra.trackingCode ?? o.trackingCode, carrier: extra.carrier ?? o.carrier } : {}),
        ...(to === "delivered" ? { deliveredAt: now } : {}),
      })
      .where(eq(orders.id, o.id))
      .returning();
    await event(tx, o.id, to, actor, extra);
    return updated!;
  });
}

/** Called by the scheduled worker; safe to run many times. */
export async function expireOrderIfDue(db: Database, orderId: string) {
  return db.transaction(async (tx) => {
    const [o] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.status, "awaiting_payment"), lt(orders.reservedUntil, new Date())))
      .for("update", { skipLocked: true });
    if (!o) return false;
    await cancelOrder(tx, o.id, { type: "system" }, "reservation expired", "expired");
    return true;
  });
}
