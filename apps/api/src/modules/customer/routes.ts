import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { appointments, customerWalletTx, customers, orders, resolveShopSettings, services, shops, staff } from "@shopino/db";
import { requestOtpSchema, rescheduleSchema, verifyOtpSchema } from "@shopino/shared";
import { isProd } from "../../config";
import { customerPhone } from "../../lib/auth";
import type { Ctx } from "../../lib/context";
import { notFound } from "../../lib/errors";
import { requestOtp, verifyOtp } from "../../lib/otp";
import { customerCancelAppointment, getSlots, rescheduleAppointment } from "../appointments/service";

const CUSTOMER_SESSION_DAYS = 30;

/**
 * Customer portal: a customer signs in with their phone and sees every booking and order made with
 * that number across all shops on the platform, and can cancel or move bookings within each shop's policy.
 */
export const customerRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    app.post("/otp", { schema: { body: requestOtpSchema }, config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req) => {
      const r = await requestOtp(ctx.redis, req.body.phone, "customer", "کد ورود به نوبت‌های من");
      return { ok: true, ttl: r.ttl, ...(r.devCode ? { devCode: r.devCode } : {}) };
    });

    app.post("/verify", { schema: { body: verifyOtpSchema }, config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
      const phone = await verifyOtp(ctx.redis, req.body.phone, req.body.code, "customer");
      const token = app.jwt.sign({ sub: phone, typ: "customer" }, { expiresIn: `${CUSTOMER_SESSION_DAYS}d` });
      reply.setCookie("cust", token, { httpOnly: true, secure: isProd, sameSite: "lax", path: "/", maxAge: CUSTOMER_SESSION_DAYS * 86400 });
      return { phone, token };
    });

    app.post("/logout", async (_req, reply) => {
      reply.clearCookie("cust", { path: "/" });
      return { ok: true };
    });

    /** every customer row (one per shop) that belongs to this phone */
    async function profiles(phone: string) {
      return ctx.db
        .select({ id: customers.id, shopId: customers.shopId, name: customers.name, points: customers.points, walletBalance: customers.walletBalance })
        .from(customers)
        .where(eq(customers.phone, phone));
    }

    app.get("/me", async (req) => {
      const phone = customerPhone(req);
      const rows = await profiles(phone);
      const shopRows = rows.length ? await ctx.db.select({ id: shops.id, name: shops.name, slug: shops.slug }).from(shops).where(inArray(shops.id, rows.map((r) => r.shopId))) : [];
      return {
        phone,
        name: rows.find((r) => r.name)?.name ?? null,
        shops: rows.map((r) => ({ ...shopRows.find((s) => s.id === r.shopId), points: r.points, walletBalance: r.walletBalance })),
      };
    });

    app.get("/wallet", async (req) => {
      const ids = (await profiles(customerPhone(req))).map((r) => r.id);
      if (!ids.length) return [];
      return ctx.db
        .select({ id: customerWalletTx.id, amount: customerWalletTx.amount, balanceAfter: customerWalletTx.balanceAfter, reason: customerWalletTx.reason, note: customerWalletTx.note, createdAt: customerWalletTx.createdAt, shopName: shops.name })
        .from(customerWalletTx)
        .innerJoin(shops, eq(shops.id, customerWalletTx.shopId))
        .where(inArray(customerWalletTx.customerId, ids))
        .orderBy(desc(customerWalletTx.createdAt))
        .limit(50);
    });

    app.get("/appointments", async (req) => {
      const phone = customerPhone(req);
      const ids = (await profiles(phone)).map((r) => r.id);
      if (!ids.length) return [];
      const rows = await ctx.db
        .select({
          appt: appointments,
          serviceName: services.name,
          durationMin: services.durationMin,
          staffName: staff.name,
          shopName: shops.name,
          shopSlug: shops.slug,
          timezone: shops.timezone,
          brandColor: shops.brandColor,
          settings: shops.settings,
        })
        .from(appointments)
        .innerJoin(services, eq(services.id, appointments.serviceId))
        .innerJoin(staff, eq(staff.id, appointments.staffId))
        .innerJoin(shops, eq(shops.id, appointments.shopId))
        .where(inArray(appointments.customerId, ids))
        .orderBy(desc(appointments.startsAt))
        .limit(100);
      return rows.map((r) => {
        const policy = resolveShopSettings(r.settings).booking;
        const open = ["pending", "confirmed"].includes(r.appt.status);
        const beforeWindow = r.appt.startsAt.getTime() - Date.now() > policy.cancelWindowMin * 60_000;
        const { accessToken, internalNote: _n, ...a } = r.appt;
        return {
          ...a,
          link: `/b/booking/${a.code}?t=${accessToken}`,
          service: { id: a.serviceId, name: r.serviceName, durationMin: r.durationMin },
          staff: { id: a.staffId, name: r.staffName },
          shop: { name: r.shopName, slug: r.shopSlug, timezone: r.timezone, brandColor: r.brandColor },
          canCancel: open && beforeWindow,
          canReschedule: open && beforeWindow && policy.customerReschedule,
          cancelWindowMin: policy.cancelWindowMin,
          refundToWallet: policy.refundToWallet,
        };
      });
    });

    app.get("/orders", async (req) => {
      const phone = customerPhone(req);
      const ids = (await profiles(phone)).map((r) => r.id);
      if (!ids.length) return [];
      const rows = await ctx.db
        .select({ order: orders, shopName: shops.name })
        .from(orders)
        .innerJoin(shops, eq(shops.id, orders.shopId))
        .where(inArray(orders.customerId, ids))
        .orderBy(desc(orders.createdAt))
        .limit(50);
      return rows.map(({ order: { accessToken, ...o }, shopName }) => ({
        id: o.id,
        code: o.code,
        status: o.status,
        paymentStatus: o.paymentStatus,
        total: o.total,
        trackingCode: o.trackingCode,
        createdAt: o.createdAt,
        shopName,
        link: `/o/${o.code}?t=${accessToken}`,
      }));
    });

    async function ownAppointment(req: Parameters<typeof customerPhone>[0], id: string) {
      const phone = customerPhone(req);
      const [row] = await ctx.db
        .select({ appt: appointments })
        .from(appointments)
        .innerJoin(customers, eq(customers.id, appointments.customerId))
        .where(and(eq(appointments.id, id), eq(customers.phone, phone)))
        .limit(1);
      if (!row) throw notFound("appointment");
      return row.appt;
    }

    const idParams = z.object({ id: z.string().uuid() });

    app.get(
      "/appointments/:id/slots",
      { schema: { params: idParams, querystring: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), anyStaff: z.coerce.boolean().default(false) }) } },
      async (req) => {
        const a = await ownAppointment(req, req.params.id);
        return { days: await getSlots(ctx.db, a.shopId, { serviceId: a.serviceId, staffId: req.query.anyStaff ? undefined : a.staffId, date: req.query.date, days: 1 }) };
      },
    );

    app.post("/appointments/:id/cancel", { schema: { params: idParams, body: z.object({ reason: z.string().max(300).optional() }) } }, async (req) => {
      const a = await ownAppointment(req, req.params.id);
      return customerCancelAppointment(ctx.db, ctx.queues, a.id, req.body.reason);
    });

    app.post("/appointments/:id/reschedule", { schema: { params: idParams, body: rescheduleSchema } }, async (req) => {
      const a = await ownAppointment(req, req.params.id);
      const updated = await rescheduleAppointment(ctx.db, ctx.queues, a.shopId, a.id, req.body, { type: "customer" }, false);
      await ctx.queues.add("notify.appointment-booked", { appointmentId: a.id });
      return { startsAt: updated.startsAt, staffId: updated.staffId };
    });
  };
