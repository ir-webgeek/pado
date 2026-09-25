import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { appointments, services, staff, staffServices, timeOff, workingHours } from "@shopino/db";
import {
  PLANS,
  appointmentStatusSchema,
  createAppointmentSchema,
  rescheduleSchema,
  serviceInputSchema,
  slotQuerySchema,
  staffInputSchema,
  timeOffInputSchema,
  walkInSchema,
  workingHoursSchema,
} from "@shopino/shared";
import type { Ctx } from "../../lib/context";
import { requireFeature, requireShop } from "../../lib/auth";
import { audit } from "../../lib/audit";
import { badRequest, notFound, paymentRequired } from "../../lib/errors";
import { env } from "../../config";
import { bookAppointment, bookWalkIn, calendar, getSlots, rescheduleAppointment, transitionAppointment } from "./service";

const params = z.object({ shopId: z.string().uuid() });
const withId = params.extend({ id: z.string().uuid() });

export const appointmentRoutes =
  (ctx: Ctx): FastifyPluginAsyncZod =>
  async (app) => {
    const actorOf = (userId: string) => ({ type: "user" as const, id: userId });

    async function setServiceStaff(shopId: string, serviceId: string, staffIds: string[]) {
      if (staffIds.length) {
        const owned = await ctx.db.select({ id: staff.id }).from(staff).where(and(eq(staff.shopId, shopId), inArray(staff.id, staffIds)));
        if (owned.length !== new Set(staffIds).size) throw badRequest("invalid_staff");
      }
      await ctx.db.delete(staffServices).where(eq(staffServices.serviceId, serviceId));
      if (staffIds.length) await ctx.db.insert(staffServices).values([...new Set(staffIds)].map((staffId) => ({ staffId, serviceId })));
    }

    // ---------------- services
    app.get("/:shopId/services", { preHandler: requireShop(ctx), schema: { params } }, async (req) => {
      const [rows, links] = await Promise.all([
        ctx.db.select().from(services).where(eq(services.shopId, req.shop.id)).orderBy(asc(services.sort), asc(services.createdAt)),
        ctx.db
          .select({ serviceId: staffServices.serviceId, staffId: staffServices.staffId })
          .from(staffServices)
          .innerJoin(services, eq(services.id, staffServices.serviceId))
          .where(eq(services.shopId, req.shop.id)),
      ]);
      return rows.map((s) => ({ ...s, staffIds: links.filter((l) => l.serviceId === s.id).map((l) => l.staffId) }));
    });

    app.post("/:shopId/services", { preHandler: requireShop(ctx, "admin"), schema: { params, body: serviceInputSchema } }, async (req) => {
      requireFeature(req.shop, "appointments");
      if (req.body.deposit.type !== "none") requireFeature(req.shop, "appointment_deposits");
      const { staffIds, ...data } = req.body;
      const [row] = await ctx.db.insert(services).values({ ...data, shopId: req.shop.id }).returning();
      await setServiceStaff(req.shop.id, row!.id, staffIds);
      await audit(ctx.db, req.shop.id, actorOf(req.user.sub), "service.create", "service", row!.id);
      return { ...row, staffIds };
    });

    app.put("/:shopId/services/:id", { preHandler: requireShop(ctx, "admin"), schema: { params: withId, body: serviceInputSchema } }, async (req) => {
      if (req.body.deposit.type !== "none") requireFeature(req.shop, "appointment_deposits");
      const { staffIds, ...data } = req.body;
      const [row] = await ctx.db
        .update(services)
        .set(data)
        .where(and(eq(services.id, req.params.id), eq(services.shopId, req.shop.id)))
        .returning();
      if (!row) throw notFound("service");
      await setServiceStaff(req.shop.id, row.id, staffIds);
      return { ...row, staffIds };
    });

    app.delete("/:shopId/services/:id", { preHandler: requireShop(ctx, "admin"), schema: { params: withId } }, async (req) => {
      // soft-disable: past appointments keep pointing at the service
      await ctx.db.update(services).set({ active: false }).where(and(eq(services.id, req.params.id), eq(services.shopId, req.shop.id)));
      return { ok: true };
    });

    // ---------------- staff
    app.get("/:shopId/staff", { preHandler: requireShop(ctx), schema: { params } }, async (req) => {
      const [rows, hours] = await Promise.all([
        ctx.db.select().from(staff).where(eq(staff.shopId, req.shop.id)).orderBy(asc(staff.sort), asc(staff.createdAt)),
        ctx.db.select().from(workingHours).where(eq(workingHours.shopId, req.shop.id)).orderBy(workingHours.weekday, workingHours.startMin),
      ]);
      return rows.map((s) => ({ ...s, workingHours: hours.filter((h) => h.staffId === s.id).map(({ weekday, startMin, endMin }) => ({ weekday, startMin, endMin })) }));
    });

    async function saveHours(shopId: string, staffId: string, rows: z.infer<typeof workingHoursSchema>) {
      await ctx.db.delete(workingHours).where(eq(workingHours.staffId, staffId));
      if (rows.length) await ctx.db.insert(workingHours).values(rows.map((r) => ({ ...r, shopId, staffId })));
    }

    app.post("/:shopId/staff", { preHandler: requireShop(ctx, "admin"), schema: { params, body: staffInputSchema } }, async (req) => {
      const limit = PLANS[req.shop.plan].limits.staff;
      if (limit !== null) {
        const [row] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(staff).where(and(eq(staff.shopId, req.shop.id), eq(staff.active, true)));
        if ((row?.n ?? 0) >= limit) throw paymentRequired("plan_limit_staff", `your plan allows ${limit} staff members`);
      }
      const { workingHours: hours, ...data } = req.body;
      const [row] = await ctx.db.insert(staff).values({ ...data, shopId: req.shop.id }).returning();
      if (hours) await saveHours(req.shop.id, row!.id, hours);
      return row;
    });

    app.put("/:shopId/staff/:id", { preHandler: requireShop(ctx, "admin"), schema: { params: withId, body: staffInputSchema } }, async (req) => {
      const { workingHours: hours, ...data } = req.body;
      const [row] = await ctx.db
        .update(staff)
        .set(data)
        .where(and(eq(staff.id, req.params.id), eq(staff.shopId, req.shop.id)))
        .returning();
      if (!row) throw notFound("staff");
      if (hours) await saveHours(req.shop.id, row.id, hours);
      return row;
    });

    app.put("/:shopId/staff/:id/hours", { preHandler: requireShop(ctx, "admin"), schema: { params: withId, body: workingHoursSchema } }, async (req) => {
      const member = await ctx.db.query.staff.findFirst({ where: and(eq(staff.id, req.params.id), eq(staff.shopId, req.shop.id)) });
      if (!member) throw notFound("staff");
      await saveHours(req.shop.id, member.id, req.body);
      return { ok: true };
    });

    // ---------------- time off / holidays
    app.get(
      "/:shopId/time-off",
      { preHandler: requireShop(ctx), schema: { params, querystring: z.object({ from: z.coerce.date(), to: z.coerce.date() }) } },
      async (req) =>
        ctx.db
          .select()
          .from(timeOff)
          .where(and(eq(timeOff.shopId, req.shop.id), lt(timeOff.startsAt, req.query.to), gt(timeOff.endsAt, req.query.from)))
          .orderBy(timeOff.startsAt),
    );
    app.post("/:shopId/time-off", { preHandler: requireShop(ctx, "staff"), schema: { params, body: timeOffInputSchema } }, async (req) => {
      if (req.body.endsAt <= req.body.startsAt) throw badRequest("invalid_range");
      if (req.body.staffId) {
        const member = await ctx.db.query.staff.findFirst({ where: and(eq(staff.id, req.body.staffId), eq(staff.shopId, req.shop.id)) });
        if (!member) throw badRequest("invalid_staff");
      }
      const [row] = await ctx.db.insert(timeOff).values({ ...req.body, shopId: req.shop.id }).returning();
      return row;
    });
    app.delete("/:shopId/time-off/:id", { preHandler: requireShop(ctx, "staff"), schema: { params: withId } }, async (req) => {
      await ctx.db.delete(timeOff).where(and(eq(timeOff.id, req.params.id), eq(timeOff.shopId, req.shop.id)));
      return { ok: true };
    });

    // ---------------- calendar & bookings
    app.get(
      "/:shopId/calendar",
      {
        preHandler: requireShop(ctx),
        schema: { params, querystring: z.object({ from: z.coerce.date(), to: z.coerce.date(), staffId: z.string().uuid().array().or(z.string().uuid()).optional() }) },
      },
      async (req) => {
        const ids = req.query.staffId ? ([] as string[]).concat(req.query.staffId) : undefined;
        if (req.query.to.getTime() - req.query.from.getTime() > 42 * 86400_000) throw badRequest("range_too_large");
        return calendar(ctx.db, req.shop.id, req.query.from, req.query.to, ids);
      },
    );

    app.get("/:shopId/slots", { preHandler: requireShop(ctx), schema: { params, querystring: slotQuerySchema } }, async (req) => ({
      days: await getSlots(ctx.db, req.shop.id, req.query),
    }));

    app.post("/:shopId/appointments", { preHandler: requireShop(ctx, "staff"), schema: { params, body: createAppointmentSchema } }, async (req) => {
      const appt = await bookAppointment(ctx.db, ctx.queues, req.shop.id, req.body, actorOf(req.user.sub), { byShop: true });
      return { ...appt, link: `${env.PUBLIC_WEB_URL}/b/booking/${appt.code}?t=${appt.accessToken}` };
    });

    app.get("/:shopId/appointments/refunds", { preHandler: requireShop(ctx, "staff"), schema: { params } }, async (req) => {
      const { appointments: rows } = await calendar(ctx.db, req.shop.id, new Date(), new Date(), undefined, { refundRequested: true });
      return rows;
    });

    // offline: walk-ins and phone bookings at any time, bypassing online booking rules
    app.post("/:shopId/appointments/walk-in", { preHandler: requireShop(ctx, "staff"), schema: { params, body: walkInSchema } }, async (req) =>
      bookWalkIn(ctx.db, ctx.queues, req.shop.id, req.body, actorOf(req.user.sub)),
    );

    app.post(
      "/:shopId/appointments/:id/refund",
      { preHandler: requireShop(ctx, "admin"), schema: { params: withId, body: z.object({ status: z.enum(["refunded", "kept"]) }) } },
      async (req) => {
        const [row] = await ctx.db
          .update(appointments)
          .set({ refundStatus: req.body.status, ...(req.body.status === "refunded" ? { paymentStatus: "refunded" as const } : {}) })
          .where(and(eq(appointments.id, req.params.id), eq(appointments.shopId, req.shop.id)))
          .returning({ id: appointments.id });
        if (!row) throw notFound("appointment");
        return { ok: true };
      },
    );

    app.get("/:shopId/appointments/:id", { preHandler: requireShop(ctx), schema: { params: withId } }, async (req) => {
      const a = await ctx.db.query.appointments.findFirst({ where: and(eq(appointments.id, req.params.id), eq(appointments.shopId, req.shop.id)) });
      if (!a) throw notFound("appointment");
      return { ...a, link: `${env.PUBLIC_WEB_URL}/b/booking/${a.code}?t=${a.accessToken}` };
    });

    app.post("/:shopId/appointments/:id/status", { preHandler: requireShop(ctx, "staff"), schema: { params: withId, body: appointmentStatusSchema } }, async (req) =>
      transitionAppointment(ctx.db, ctx.queues, req.shop.id, req.params.id, req.body.status, actorOf(req.user.sub), req.body.reason),
    );

    app.post("/:shopId/appointments/:id/reschedule", { preHandler: requireShop(ctx, "staff"), schema: { params: withId, body: rescheduleSchema } }, async (req) =>
      rescheduleAppointment(ctx.db, ctx.queues, req.shop.id, req.params.id, req.body, actorOf(req.user.sub), true),
    );

    app.patch(
      "/:shopId/appointments/:id/notes",
      { preHandler: requireShop(ctx, "staff"), schema: { params: withId, body: z.object({ internalNote: z.string().max(2000) }) } },
      async (req) => {
        const [row] = await ctx.db
          .update(appointments)
          .set({ internalNote: req.body.internalNote })
          .where(and(eq(appointments.id, req.params.id), eq(appointments.shopId, req.shop.id)))
          .returning({ id: appointments.id });
        if (!row) throw notFound("appointment");
        return { ok: true };
      },
    );
  };
