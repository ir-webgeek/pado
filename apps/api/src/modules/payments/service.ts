import { and, eq } from "drizzle-orm";
import { appointments, categories, orderItems, orders, payments, products, resolveShopSettings, services, shops, type Database } from "@shopino/db";
import { normalizeIranPhone, type PaymentMethod } from "@shopino/shared";
import { env, publicApiUrl } from "../../config";
import { badRequest, conflict, notFound } from "../../lib/errors";
import type { Queues } from "../../lib/queues";
import { markAppointmentPaid } from "../appointments/service";
import { markOrderPaid } from "../orders/service";
import { customerWalletMove, walletMove } from "../wallet/service";
import { activeProvider, installmentProvider, providerByName } from "./providers";
import type { InstallmentCart } from "./providers/types";
import { cfg, cfgNumber } from "../../lib/platform";

export type PaymentStart =
  | { kind: "redirect"; url: string; paymentId: string }
  | { kind: "card_to_card"; paymentId: string; amount: number; card: { cardNumber: string; holder: string; bank: string } }
  | { kind: "paid"; paymentId?: string };

const webOrderUrl = (o: { code: string; accessToken: string }) => `${env.PUBLIC_WEB_URL}/o/${o.code}?t=${o.accessToken}`;
const webBookingUrl = (a: { code: string; accessToken: string }) => `${env.PUBLIC_WEB_URL}/b/booking/${a.code}?t=${a.accessToken}`;

async function start(
  db: Database,
  input: {
    shopId: string;
    purpose: "order" | "appointment" | "wallet_topup";
    orderId?: string;
    appointmentId?: string;
    amount: number;
    method: PaymentMethod;
    description: string;
    mobile?: string;
    /** for installment (BNPL) providers */
    cart?: InstallmentCart;
  },
): Promise<PaymentStart> {
  if (input.amount <= 0) return { kind: "paid" };
  // commission applies to customer payments only (not the shop's own wallet top-ups)
  const platformFee = input.purpose === "wallet_topup" ? 0 : Math.round((input.amount * cfgNumber("PLATFORM_FEE_PERCENT", env.PLATFORM_FEE_PERCENT)) / 100);
  if (input.method === "card_to_card") {
    const shop = await db.query.shops.findFirst({ where: eq(shops.id, input.shopId) });
    const card = resolveShopSettings(shop!.settings).cardToCard;
    if (!card.cardNumber) throw badRequest("card_to_card_disabled", "this shop does not accept card-to-card payments");
    const [p] = await db
      .insert(payments)
      .values({ shopId: input.shopId, purpose: input.purpose, orderId: input.orderId, appointmentId: input.appointmentId, provider: "card_to_card", method: "card_to_card", amount: input.amount, platformFee })
      .returning();
    return { kind: "card_to_card", paymentId: p!.id, amount: input.amount, card };
  }
  if (input.method !== "gateway" && input.method !== "installment") throw badRequest("unsupported_method");

  const provider = input.method === "installment" ? installmentProvider() : activeProvider();
  if (!provider) throw badRequest("installment_unavailable", "installment payment is not available right now");
  if (input.method === "installment" && !input.cart) throw badRequest("installment_unavailable", "installments are available for orders and bookings only");
  const [p] = await db
    .insert(payments)
    .values({ shopId: input.shopId, purpose: input.purpose, orderId: input.orderId, appointmentId: input.appointmentId, provider: provider.name, method: input.method, amount: input.amount, platformFee })
    .returning();
  const shop = await db.query.shops.findFirst({ where: eq(shops.id, input.shopId), columns: { settlementIban: true } });
  const { authority, redirectUrl } = await provider.request({
    amount: input.amount,
    description: input.description,
    callbackUrl: `${publicApiUrl()}/v1/pay/callback/${provider.name}?pid=${p!.id}`,
    mobile: input.mobile ? (normalizeIranPhone(input.mobile) ?? undefined) : undefined,
    cart: input.cart,
    splits:
      provider.supportsSplit && shop?.settlementIban && cfg("PLATFORM_IBAN") && platformFee > 0
        ? [
            { iban: shop.settlementIban, amount: input.amount - platformFee, role: "merchant" },
            { iban: cfg("PLATFORM_IBAN")!, amount: platformFee, role: "platform" },
          ]
        : undefined,
  });
  await db.update(payments).set({ authority }).where(eq(payments.id, p!.id));
  return { kind: "redirect", url: redirectUrl, paymentId: p!.id };
}

/**
 * Pays an order or booking from the customer's store credit at that shop. The target row is locked
 * first, so a repeated request sees it already paid and never debits twice. No platform fee: it was
 * taken when the money first came in.
 */
async function payFromWallet(
  db: Database,
  queues: Queues,
  input: { shopId: string; customerId: string; amount: number } & ({ purpose: "order"; orderId: string } | { purpose: "appointment"; appointmentId: string }),
): Promise<PaymentStart> {
  const paymentId = await db.transaction(async (tx) => {
    if (input.purpose === "order") {
      const [o] = await tx.select({ paymentStatus: orders.paymentStatus }).from(orders).where(eq(orders.id, input.orderId)).for("update");
      if (o?.paymentStatus === "paid") return null;
    } else {
      const [a] = await tx.select({ paymentStatus: appointments.paymentStatus }).from(appointments).where(eq(appointments.id, input.appointmentId)).for("update");
      if (a?.paymentStatus === "paid") return null;
    }
    const refId = input.purpose === "order" ? input.orderId : input.appointmentId;
    await customerWalletMove(tx, input.shopId, input.customerId, -input.amount, "payment", { type: input.purpose, id: refId });
    const [p] = await tx
      .insert(payments)
      .values({
        shopId: input.shopId,
        purpose: input.purpose,
        orderId: input.purpose === "order" ? input.orderId : null,
        appointmentId: input.purpose === "appointment" ? input.appointmentId : null,
        provider: "wallet",
        method: "wallet",
        amount: input.amount,
        status: "paid",
        paidAt: new Date(),
      })
      .returning({ id: payments.id });
    if (input.purpose === "order") await markOrderPaid(tx, input.orderId, { type: "customer" }, { method: "wallet", refId: p!.id });
    else await markAppointmentPaid(tx, input.appointmentId, input.amount);
    return p!.id;
  });
  if (!paymentId) return { kind: "paid" };
  if (input.purpose === "order") await queues.add("notify.order-paid", { orderId: input.orderId });
  else await queues.add("notify.appointment-booked", { appointmentId: input.appointmentId });
  return { kind: "paid", paymentId };
}

/** Order lines and delivery details in the shape installment providers underwrite. */
async function orderCart(db: Database, o: typeof orders.$inferSelect): Promise<InstallmentCart> {
  const [shop, lines] = await Promise.all([
    db.query.shops.findFirst({ where: eq(shops.id, o.shopId), columns: { slug: true } }),
    db
      .select({ id: orderItems.id, productId: orderItems.productId, variantId: orderItems.variantId, title: orderItems.title, variantLabel: orderItems.variantLabel, unitPrice: orderItems.unitPrice, quantity: orderItems.quantity, slug: products.slug, category: categories.name })
      .from(orderItems)
      .leftJoin(products, eq(products.id, orderItems.productId))
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .where(eq(orderItems.orderId, o.id)),
  ]);
  return {
    reference: o.code,
    items: lines.map((l) => ({
      id: l.variantId ?? l.id,
      productId: l.productId ?? l.id,
      name: l.variantLabel ? `${l.title} - ${l.variantLabel}` : l.title,
      count: l.quantity,
      unitAmount: l.unitPrice,
      category: l.category ?? "",
      url: l.slug && shop ? `${env.PUBLIC_WEB_URL}/s/${shop.slug}/p/${l.slug}` : "",
    })),
    shippingAmount: o.shippingTotal,
    discountAmount: o.discountTotal + o.pointsDiscount,
    customer: { name: o.address?.fullName ?? "", province: o.address?.province ?? "", city: o.address?.city ?? "", address: o.address?.line ?? "", postalCode: o.address?.postalCode ?? "" },
  };
}

export async function startOrderPayment(db: Database, queues: Queues, orderId: string): Promise<PaymentStart> {
  const o = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!o) throw notFound("order");
  if (o.paymentStatus === "paid") return { kind: "paid" };
  if (o.total === 0) {
    await db.transaction((tx) => markOrderPaid(tx, o.id, { type: "customer" }, { method: "wallet" }));
    return { kind: "paid" };
  }
  if (o.paymentMethod === "wallet") {
    if (!o.customerId) throw badRequest("customer_required");
    return payFromWallet(db, queues, { purpose: "order", orderId: o.id, shopId: o.shopId, customerId: o.customerId, amount: o.total });
  }
  return start(db, {
    shopId: o.shopId,
    purpose: "order",
    orderId: o.id,
    amount: o.total,
    method: o.paymentMethod ?? "gateway",
    description: `Order ${o.code}`,
    mobile: o.address?.phone,
    cart: o.paymentMethod === "installment" ? await orderCart(db, o) : undefined,
  });
}

export async function startAppointmentPayment(db: Database, queues: Queues, appointmentId: string, method: PaymentMethod): Promise<PaymentStart> {
  const a = await db.query.appointments.findFirst({ where: eq(appointments.id, appointmentId) });
  if (!a) throw notFound("appointment");
  if (a.paymentStatus === "paid") return { kind: "paid" };
  if (a.status === "cancelled") throw conflict("appointment_cancelled", "this booking was cancelled");
  const amount = a.depositAmount > 0 ? a.depositAmount : a.price - a.discountTotal;
  if (method === "wallet") return payFromWallet(db, queues, { purpose: "appointment", appointmentId: a.id, shopId: a.shopId, customerId: a.customerId, amount });
  let cart: InstallmentCart | undefined;
  let mobile: string | undefined;
  if (method === "installment") {
    const [svc, cust] = await Promise.all([
      db.query.services.findFirst({ where: eq(services.id, a.serviceId), columns: { name: true } }),
      db.query.customers.findFirst({ where: (c, { eq: e }) => e(c.id, a.customerId), columns: { name: true, phone: true } }),
    ]);
    mobile = cust?.phone ?? undefined;
    cart = {
      reference: a.code,
      items: [{ id: a.id, productId: a.serviceId, name: svc?.name ?? "Booking", count: 1, unitAmount: amount, category: "خدمات", url: "" }],
      shippingAmount: 0,
      discountAmount: 0,
      customer: { name: cust?.name ?? "", province: "", city: "", address: "", postalCode: "" },
    };
  }
  return start(db, { shopId: a.shopId, purpose: "appointment", appointmentId: a.id, amount, method, description: `Booking ${a.code}`, mobile, cart });
}

export async function startWalletTopup(db: Database, shopId: string, amount: number): Promise<PaymentStart> {
  return start(db, { shopId, purpose: "wallet_topup", amount, method: "gateway", description: "Wallet top-up" });
}

/** Background retry of an installment settle that failed during the callback (throws so the queue retries). */
export async function retryProviderSettle(db: Database, paymentId: string) {
  const p = await db.query.payments.findFirst({ where: eq(payments.id, paymentId) });
  if (!p?.authority || !(p.meta as { settlePending?: boolean } | null)?.settlePending) return;
  const provider = providerByName(p.provider);
  if (!provider?.settle) return;
  if (!(await provider.settle(p.authority))) throw new Error(`${p.provider} settle still failing for payment ${p.id}`);
  await db.update(payments).set({ meta: { settlePending: false, settledAt: new Date().toISOString() } }).where(eq(payments.id, p.id));
}

/** Marks a payment paid and applies it to whatever it was for. Shared by gateway callbacks and receipt approval. */
async function settle(db: Database, queues: Queues, paymentId: string, refId?: string) {
  const applied = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!p) throw notFound("payment");
    if (p.status === "paid") return { p, fresh: false };
    await tx.update(payments).set({ status: "paid", refId, paidAt: new Date() }).where(eq(payments.id, p.id));
    if (p.purpose === "order" && p.orderId) await markOrderPaid(tx, p.orderId, { type: "customer" }, { method: p.method, refId });
    if (p.purpose === "appointment" && p.appointmentId) await markAppointmentPaid(tx, p.appointmentId, p.amount);
    if (p.purpose === "wallet_topup") await walletMove(tx, p.shopId, "topup", p.amount, { type: "payment", id: p.id });
    return { p, fresh: true };
  });
  if (applied.fresh) {
    if (applied.p.orderId) await queues.add("notify.order-paid", { orderId: applied.p.orderId });
    if (applied.p.appointmentId) await queues.add("notify.appointment-booked", { appointmentId: applied.p.appointmentId });
  }
  return applied.p;
}

export async function handleGatewayCallback(db: Database, queues: Queues, providerName: string, query: Record<string, string | undefined>) {
  const p = query.pid ? await db.query.payments.findFirst({ where: and(eq(payments.id, query.pid), eq(payments.provider, providerName)) }) : undefined;
  if (!p || !p.authority) throw notFound("payment");
  const provider = providerByName(providerName);
  if (!provider) throw notFound("provider");

  let ok = p.status === "paid";
  if (!ok) {
    const res = await provider.verify({ authority: p.authority, amount: p.amount, query });
    ok = res.ok;
    if (ok) {
      await settle(db, queues, p.id, res.refId);
      // approved by the installment provider but its settle call did not go through: retry in the background
      if (res.settlePending) {
        await db.update(payments).set({ meta: { settlePending: true } }).where(eq(payments.id, p.id));
        await queues.add("payment.settle-retry", { paymentId: p.id }, { attempts: 8, backoff: { type: "exponential", delay: 60_000 } });
      }
    } else {
      await db.update(payments).set({ status: "failed", meta: (res.raw as object) ?? null }).where(eq(payments.id, p.id));
    }
  }
  return { payment: p, ok, redirect: await resultUrl(db, p, ok) };
}

async function resultUrl(db: Database, p: typeof payments.$inferSelect, ok: boolean) {
  const flag = ok ? "paid=1" : "paid=0";
  if (p.orderId) {
    const o = await db.query.orders.findFirst({ where: eq(orders.id, p.orderId) });
    return `${webOrderUrl(o!)}&${flag}`;
  }
  if (p.appointmentId) {
    const a = await db.query.appointments.findFirst({ where: eq(appointments.id, p.appointmentId) });
    return `${webBookingUrl(a!)}&${flag}`;
  }
  return `${env.PUBLIC_WEB_URL}/panel/wallet?${flag}`;
}

export async function attachReceipt(db: Database, queues: Queues, paymentId: string, receiptUrl: string) {
  const [p] = await db
    .update(payments)
    .set({ receiptUrl, status: "pending_review" })
    .where(and(eq(payments.id, paymentId), eq(payments.method, "card_to_card"), eq(payments.status, "initiated")))
    .returning();
  if (!p) throw conflict("receipt_not_accepted", "this payment is not waiting for a receipt");
  if (p.orderId) await db.update(orders).set({ paymentStatus: "pending_review" }).where(eq(orders.id, p.orderId));
  if (p.appointmentId) await db.update(appointments).set({ paymentStatus: "pending_review" }).where(eq(appointments.id, p.appointmentId));
  await queues.add("notify.receipt-uploaded", { paymentId: p.id });
  return p;
}

export async function reviewReceipt(db: Database, queues: Queues, shopId: string, paymentId: string, approve: boolean) {
  const p = await db.query.payments.findFirst({ where: and(eq(payments.id, paymentId), eq(payments.shopId, shopId)) });
  if (!p) throw notFound("payment");
  if (p.status !== "pending_review") throw conflict("not_pending_review");
  if (approve) return settle(db, queues, p.id, "card-to-card");
  await db.update(payments).set({ status: "failed" }).where(eq(payments.id, p.id));
  if (p.orderId) await db.update(orders).set({ paymentStatus: "unpaid" }).where(eq(orders.id, p.orderId));
  if (p.appointmentId) await db.update(appointments).set({ paymentStatus: "unpaid" }).where(eq(appointments.id, p.appointmentId));
  return { ...p, status: "failed" };
}
