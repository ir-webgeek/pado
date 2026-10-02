import { and, eq, gt, isNotNull } from "drizzle-orm";
import type { Redis } from "ioredis";
import { appointments, campaigns, conversations, customers, messages, orders, payments, resolveShopSettings, services, shops, staff, type Database } from "@shopino/db";
import { sendText } from "../instagram/client";
import { formatJalali, formatToman } from "@shopino/shared";
import { env } from "../../config";
import { segmentWhere } from "../campaigns/routes";
import { walletMove } from "../wallet/service";
import { sendSms, smsParts } from "./sms";
import { escapeHtml, sendTelegram } from "./telegram";

const timeFa = (d: Date, tz: string) => formatJalali(d, { dateStyle: undefined, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }, tz);

type ShopRow = typeof shops.$inferSelect;
type AlertKind = "onHandoff" | "onOrder" | "onBooking";

/** SMS to the shop manager, when they turned that alert on and set a mobile number. */
async function alertManager(shop: ShopRow, kind: AlertKind, text: string) {
  const { alerts } = resolveShopSettings(shop.settings);
  if (!alerts[kind] || !alerts.phone) return;
  const r = await sendSms(alerts.phone, text);
  if (!r.ok) throw new Error("sms provider rejected the message");
}

/**
 * Claims a dedupe key, then sends. A failed send releases the key and rethrows, so the job's retry
 * sends again instead of finding the key taken and silently dropping the message.
 */
async function sendOnce(redis: Redis | undefined, key: string, ttlSec: number, send: () => Promise<void>) {
  if (redis && (await redis.set(key, "1", "EX", ttlSec, "NX")) !== "OK") return;
  try {
    await send();
  } catch (err) {
    if (redis) await redis.del(key);
    throw err;
  }
}

const HANDOFF_REASONS: Record<string, string> = {
  "wallet empty": "موجودی کیف پول برای هوش مصنوعی تمام شده",
  "agent could not produce a reply": "ایجنت نتوانست پاسخ بدهد",
  "assistant declined to answer": "ایجنت پاسخ را به انسان سپرد",
  automation: "پاسخ خودکار گفتگو را به شما سپرد",
};

/** One SMS per conversation per 30 minutes, so a chatty customer does not flood the manager. */
export async function notifyHandoff(db: Database, redis: Redis, conversationId: string, reason: string) {
  const conv = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) });
  if (!conv) return;
  const shop = await db.query.shops.findFirst({ where: eq(shops.id, conv.shopId) });
  if (!shop) return;
  const customer = conv.customerId ? await db.query.customers.findFirst({ where: eq(customers.id, conv.customerId) }) : undefined;
  const who = customer?.name ?? (conv.username ? `@${conv.username}` : "یک مشتری");
  const why = HANDOFF_REASONS[reason] ?? reason.slice(0, 80);
  await sendOnce(redis, `alert:handoff:${conv.id}`, 1800, () =>
    alertManager(shop, "onHandoff", `${shop.name}: ${who} در دایرکت به مشاور نیاز دارد (${why}). پاسخ: ${env.PUBLIC_WEB_URL}/panel/inbox`),
  );
}

async function orderCtx(db: Database, orderId: string) {
  const o = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!o) return null;
  const [shop, customer] = await Promise.all([
    db.query.shops.findFirst({ where: eq(shops.id, o.shopId) }),
    o.customerId ? db.query.customers.findFirst({ where: eq(customers.id, o.customerId) }) : Promise.resolve(undefined),
  ]);
  return { o, shop: shop!, customer, link: `${env.PUBLIC_WEB_URL}/o/${o.code}?t=${o.accessToken}` };
}

export async function notifyOrderPaid(db: Database, orderId: string, redis?: Redis) {
  const c = await orderCtx(db, orderId);
  if (!c) return;
  const phone = c.o.address?.phone ?? c.customer?.phone;
  // keyed so a retry after a later step fails (e.g. Telegram) does not text the customer twice
  if (phone && !c.customer?.smsOptOut) {
    await sendOnce(redis, `sms:order-paid:${c.o.id}`, 7 * 86400, async () => {
      const r = await sendSms(phone, `${c.shop.name}: سفارش ${c.o.code} ثبت و پرداخت شد. پیگیری: ${c.link}`);
      if (!r.ok) throw new Error("sms provider rejected the message");
    });
  }
  await sendOnce(redis, `alert:order:${c.o.id}`, 7 * 86400, () =>
    alertManager(c.shop, "onOrder", `${c.shop.name}: سفارش جدید ${c.o.code} به مبلغ ${formatToman(c.o.total)} پرداخت شد. ${env.PUBLIC_WEB_URL}/panel/orders/${c.o.id}`),
  );
  if (c.shop.telegramChatId) {
    await sendTelegram(
      c.shop.telegramChatId,
      `🛍️ <b>New paid order</b>\nShop: ${escapeHtml(c.shop.name)}\nOrder: ${c.o.code}\nCustomer: ${escapeHtml(c.customer?.name ?? c.o.address?.fullName ?? "-")}\nAmount: ${formatToman(c.o.total, "en")}\nChannel: ${c.o.channel}`,
      { text: "Open in Shopino", url: `${env.PUBLIC_WEB_URL}/panel/orders/${c.o.id}` },
    );
  }
}

export async function notifyOrderShipped(db: Database, orderId: string) {
  const c = await orderCtx(db, orderId);
  if (!c) return;
  const phone = c.o.address?.phone ?? c.customer?.phone;
  if (phone && !c.customer?.smsOptOut) {
    await sendSms(phone, `${c.shop.name}: سفارش ${c.o.code} ارسال شد${c.o.trackingCode ? `، کد رهگیری ${c.o.trackingCode}` : ""}. ${c.link}`);
  }
}

export async function notifyReceiptUploaded(db: Database, paymentId: string) {
  const p = await db.query.payments.findFirst({ where: eq(payments.id, paymentId) });
  if (!p) return;
  const shop = await db.query.shops.findFirst({ where: eq(shops.id, p.shopId) });
  if (shop?.telegramChatId) {
    await sendTelegram(shop.telegramChatId, `🧾 <b>Card-to-card receipt to review</b>\nAmount: ${formatToman(p.amount, "en")}`, {
      text: "Review",
      url: `${env.PUBLIC_WEB_URL}/panel/orders?tab=receipts`,
    });
  }
}

async function apptCtx(db: Database, appointmentId: string) {
  const a = await db.query.appointments.findFirst({ where: eq(appointments.id, appointmentId) });
  if (!a) return null;
  const [shop, customer, svc, st] = await Promise.all([
    db.query.shops.findFirst({ where: eq(shops.id, a.shopId) }),
    db.query.customers.findFirst({ where: eq(customers.id, a.customerId) }),
    db.query.services.findFirst({ where: eq(services.id, a.serviceId) }),
    db.query.staff.findFirst({ where: eq(staff.id, a.staffId) }),
  ]);
  return { a, shop: shop!, customer: customer!, svc: svc!, st: st!, link: `${env.PUBLIC_WEB_URL}/b/booking/${a.code}?t=${a.accessToken}` };
}

export async function notifyAppointmentBooked(db: Database, appointmentId: string, redis?: Redis) {
  const c = await apptCtx(db, appointmentId);
  if (!c || c.a.status === "cancelled") return;
  const when = timeFa(c.a.startsAt, c.shop.timezone);
  // this job runs on create, confirm, payment and reschedule: text the customer once per status + time
  const phone = c.customer.phone;
  if (phone && !c.customer.smsOptOut) {
    const state = c.a.status === "confirmed" ? "تایید شد" : "ثبت شد و در انتظار تایید است";
    await sendOnce(redis, `sms:booking:${c.a.id}:${c.a.status}:${c.a.startsAt.getTime()}`, 7 * 86400, async () => {
      const r = await sendSms(phone, `${c.shop.name}: نوبت ${c.svc.name} برای ${when} ${state}. ${c.link}`);
      if (!r.ok) throw new Error("sms provider rejected the message");
    });
  }
  // online bookings only (the shop entered the others itself), once per booking: this job also runs on
  // confirmation, payment and reschedule
  if (redis && !["pos", "phone"].includes(c.a.channel)) {
    await sendOnce(redis, `alert:booking:${c.a.id}`, 7 * 86400, () =>
      alertManager(c.shop, "onBooking", `${c.shop.name}: نوبت آنلاین ${c.a.code}، ${c.svc.name} با ${c.st.name}، ${when} (${c.customer.name ?? c.customer.phone ?? ""}).`),
    );
  }
  if (c.shop.telegramChatId) {
    await sendTelegram(
      c.shop.telegramChatId,
      `📅 <b>New booking</b> (${c.a.status})\n${escapeHtml(c.svc.name)} with ${escapeHtml(c.st.name)}\n${escapeHtml(c.customer.name ?? "-")} · ${c.customer.phone ?? ""}\n${c.a.startsAt.toISOString()}`,
      { text: "Open calendar", url: `${env.PUBLIC_WEB_URL}/panel/appointments` },
    );
  }
}

export async function notifyAppointmentCancelled(db: Database, appointmentId: string) {
  const c = await apptCtx(db, appointmentId);
  if (!c) return;
  if (c.customer.phone && !c.customer.smsOptOut && c.a.cancelledBy !== "customer") {
    await sendSms(c.customer.phone, `${c.shop.name}: نوبت ${c.svc.name} در ${timeFa(c.a.startsAt, c.shop.timezone)} لغو شد. برای نوبت جدید: ${env.PUBLIC_WEB_URL}/b/${c.shop.slug}`);
  }
  if (c.shop.telegramChatId && c.a.cancelledBy === "customer") {
    await sendTelegram(c.shop.telegramChatId, `❌ Booking cancelled by customer: ${escapeHtml(c.svc.name)} · ${escapeHtml(c.customer.name ?? "")}`);
  }
}

export async function notifyWalletRefund(db: Database, appointmentId: string) {
  const c = await apptCtx(db, appointmentId);
  if (!c || c.a.refundStatus !== "wallet" || !c.customer.phone || c.customer.smsOptOut) return;
  await sendSms(
    c.customer.phone,
    `${c.shop.name}: مبلغ ${formatToman(c.a.paidAmount)} بابت لغو نوبت ${c.svc.name} به کیف پول شما برگشت. موجودی: ${formatToman(c.customer.walletBalance)}. ${env.PUBLIC_WEB_URL}/me`,
  );
}

export async function sendAppointmentReminder(db: Database, appointmentId: string, offsetMin: number) {
  const c = await apptCtx(db, appointmentId);
  if (!c || !["confirmed", "pending"].includes(c.a.status)) return;
  // a rescheduled booking leaves stale jobs behind: only send when this job still matches the start time
  const due = c.a.startsAt.getTime() - offsetMin * 60_000;
  if (Math.abs(Date.now() - due) > 15 * 60_000) return;
  const text = `یادآوری ${c.shop.name}: نوبت ${c.svc.name} با ${c.st.name}، ${timeFa(c.a.startsAt, c.shop.timezone)}. تغییر یا لغو: ${c.link}`;
  // Instagram DM is free but only allowed within 24h of the customer's last message; otherwise SMS
  if (c.customer.instagramId && c.shop.igUserId && c.shop.igAccessToken) {
    const conv = await db.query.conversations.findFirst({
      where: and(eq(conversations.shopId, c.shop.id), eq(conversations.channel, "instagram"), eq(conversations.externalUserId, c.customer.instagramId)),
    });
    if (conv?.lastInboundAt && Date.now() - conv.lastInboundAt.getTime() < 23 * 3600_000) {
      try {
        await sendText({ igUserId: c.shop.igUserId, accessToken: c.shop.igAccessToken }, c.customer.instagramId, text);
        await db.insert(messages).values({ shopId: c.shop.id, conversationId: conv.id, direction: "out", sender: "system", text });
        return;
      } catch {
        // fall through to SMS
      }
    }
  }
  if (!c.customer.phone || c.customer.smsOptOut) return;
  await sendSms(c.customer.phone, text);
}

/** Sends in batches, charging the wallet per batch so a campaign stops cleanly when credit runs out. */
export async function sendCampaign(db: Database, campaignId: string) {
  const [c] = await db
    .update(campaigns)
    .set({ status: "sending" })
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, "queued")))
    .returning();
  if (!c) return;
  const parts = smsParts(c.message);
  let lastId: string | null = null;
  let sent = 0;
  let cost = 0;
  try {
    for (;;) {
      const batch: { id: string; phone: string | null }[] = await db
        .select({ id: customers.id, phone: customers.phone })
        .from(customers)
        .where(and(segmentWhere(c.shopId, c.segment), isNotNull(customers.phone), lastId ? gt(customers.id, lastId) : undefined))
        .orderBy(customers.id)
        .limit(200);
      if (!batch.length) break;
      const batchCost = batch.length * parts * env.SMS_COST_PER_PART;
      await walletMove(db, c.shopId, "sms", -batchCost, { type: "campaign", id: c.id });
      for (const r of batch) await sendSms(r.phone!, c.message);
      sent += batch.length;
      cost += batchCost;
      lastId = batch.at(-1)!.id;
      await db.update(campaigns).set({ sentCount: sent, cost }).where(eq(campaigns.id, c.id));
    }
    await db.update(campaigns).set({ status: "sent", sentAt: new Date(), sentCount: sent, cost }).where(eq(campaigns.id, c.id));
  } catch (err) {
    await db.update(campaigns).set({ status: "failed", sentCount: sent, cost }).where(eq(campaigns.id, c.id));
    throw err;
  }
}

