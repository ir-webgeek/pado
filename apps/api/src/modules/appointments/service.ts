import { and, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import {
  appointments,
  customers,
  services,
  shops,
  staff,
  staffServices,
  timeOff,
  workingHours,
  resolveShopSettings,
  type Database,
  type DbOrTx,
  type ShopSettings,
  type Tx,
} from "@shopino/db";
import {
  APPOINTMENT_TRANSITIONS,
  BLOCKING_APPOINTMENT_STATUSES,
  PLANS,
  addDaysIso,
  bookingCode,
  percentOf,
  planHas,
  zonedIsoDate,
  zonedToUtc,
  type AppointmentStatus,
  type CreateAppointmentInput,
} from "@shopino/shared";
import type { Actor } from "../../lib/audit";
import { audit } from "../../lib/audit";
import { randomToken } from "../../lib/crypto";
import { badRequest, conflict, notFound, paymentRequired } from "../../lib/errors";
import type { Queues } from "../../lib/queues";
import { recordPurchase, upsertCustomer } from "../customers/service";
import { consumeDiscount, evaluateDiscount } from "../discounts/service";
import { computeSlots, pickStaff, type BusyBlock, type DaySlots, type StaffAvailabilityInput } from "./slots";

const MIN = 60_000;
const DEPOSIT_HOLD_MIN = 20;

async function loadShop(db: DbOrTx, shopId: string) {
  const shop = await db.query.shops.findFirst({ where: eq(shops.id, shopId) });
  if (!shop) throw notFound("shop");
  return { shop, settings: resolveShopSettings(shop.settings) };
}

async function loadService(db: DbOrTx, shopId: string, serviceId: string) {
  const svc = await db.query.services.findFirst({ where: and(eq(services.id, serviceId), eq(services.shopId, shopId)) });
  if (!svc || !svc.active) throw notFound("service");
  return svc;
}

/** Build the pure-engine input for a service over a date range, optionally for one staff member. */
export async function availabilityInput(db: DbOrTx, shopId: string, serviceId: string, fromDate: string, days: number, staffId?: string) {
  const [{ shop, settings }, svc] = await Promise.all([loadShop(db, shopId), loadService(db, shopId, serviceId)]);
  const links = await db
    .select({ staff, durationOverride: staffServices.durationOverride, priceOverride: staffServices.priceOverride })
    .from(staffServices)
    .innerJoin(staff, eq(staff.id, staffServices.staffId))
    .where(and(eq(staffServices.serviceId, svc.id), eq(staff.active, true), staffId ? eq(staff.id, staffId) : undefined));
  if (staffId && links.length === 0) throw badRequest("staff_not_offering", "this staff member does not offer this service");
  const staffIds = links.map((l) => l.staff.id);

  // range in UTC with a day of slack on each side for timezone edges
  const rangeStart = zonedToUtc(addDaysIso(fromDate, -1), 0, shop.timezone);
  const rangeEnd = zonedToUtc(addDaysIso(fromDate, days + 1), 0, shop.timezone);

  const [hours, busy, off] = staffIds.length
    ? await Promise.all([
        db.select().from(workingHours).where(inArray(workingHours.staffId, staffIds)),
        db
          .select({
            staffId: appointments.staffId,
            serviceId: appointments.serviceId,
            startsAt: appointments.startsAt,
            blockStart: appointments.blockStart,
            blockEnd: appointments.blockEnd,
          })
          .from(appointments)
          .where(
            and(
              inArray(appointments.staffId, staffIds),
              inArray(appointments.status, BLOCKING_APPOINTMENT_STATUSES),
              lt(appointments.blockStart, rangeEnd),
              gte(appointments.blockEnd, rangeStart),
            ),
          ),
        db
          .select()
          .from(timeOff)
          .where(and(eq(timeOff.shopId, shopId), lt(timeOff.startsAt, rangeEnd), gte(timeOff.endsAt, rangeStart))),
      ])
    : [[], [], []];

  const staffInput: StaffAvailabilityInput[] = links.map((l) => ({
    staffId: l.staff.id,
    durationMin: l.durationOverride ?? undefined,
    hours: hours.filter((h) => h.staffId === l.staff.id),
    busy: busy
      .filter((b) => b.staffId === l.staff.id)
      .map<BusyBlock>((b) => ({ serviceId: b.serviceId, startsAt: b.startsAt.getTime(), start: b.blockStart.getTime(), end: b.blockEnd.getTime() })),
    timeOff: off.filter((o) => o.staffId === l.staff.id).map((o) => ({ start: o.startsAt.getTime(), end: o.endsAt.getTime() })),
  }));

  return {
    shop,
    settings,
    service: svc,
    links,
    query: {
      timezone: shop.timezone,
      fromDate,
      days,
      service: { id: svc.id, durationMin: svc.durationMin, bufferBeforeMin: svc.bufferBeforeMin, bufferAfterMin: svc.bufferAfterMin, capacity: svc.capacity },
      staff: staffInput,
      shopTimeOff: off.filter((o) => o.staffId === null).map((o) => ({ start: o.startsAt.getTime(), end: o.endsAt.getTime() })),
      stepMin: settings.booking.slotStepMin,
      minNoticeMin: settings.booking.minNoticeMin,
      maxAdvanceDays: settings.booking.maxAdvanceDays,
      now: Date.now(),
    },
  };
}

export async function getSlots(db: DbOrTx, shopId: string, q: { serviceId: string; staffId?: string; date: string; days: number }): Promise<DaySlots[]> {
  const input = await availabilityInput(db, shopId, q.serviceId, q.date, q.days, q.staffId);
  return computeSlots(input.query);
}

function depositFor(price: number, rule: { type: "none" | "fixed" | "percent"; value: number }) {
  if (rule.type === "fixed") return Math.min(rule.value, price);
  if (rule.type === "percent") return percentOf(price, Math.min(rule.value, 100));
  return 0;
}

async function assertMonthlyBookingLimit(db: DbOrTx, shopId: string, plan: keyof typeof PLANS) {
  const limit = PLANS[plan].limits.bookingsPerMonth;
  if (limit === null) return;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(appointments)
    .where(and(eq(appointments.shopId, shopId), sql`${appointments.createdAt} >= date_trunc('month', now())`));
  if ((row?.n ?? 0) >= limit) throw paymentRequired("plan_limit_bookings", `your plan allows ${limit} bookings per month`);
}

/** Serialize concurrent bookings per staff member. Locks are taken in id order to avoid deadlocks. */
async function lockStaff(tx: Tx, staffIds: string[]) {
  for (const id of [...staffIds].sort()) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"staff:" + id}, 0))`);
  }
}

export interface BookOptions {
  /** shop staff creating the booking: skips notice / advance limits and auto-confirms */
  byShop?: boolean;
  conversationId?: string;
}

export async function bookAppointment(db: Database, queues: Queues, shopId: string, input: CreateAppointmentInput, actor: Actor, opts: BookOptions = {}) {
  const startsAtMs = input.startsAt.getTime();

  const result = await db.transaction(async (tx) => {
    const { shop, settings } = await loadShop(tx, shopId);
    if (!planHas(shop.plan, "appointments")) throw paymentRequired("plan_feature", "appointments are not on your plan");
    await assertMonthlyBookingLimit(tx, shopId, shop.plan);

    const date = zonedIsoDate(input.startsAt, shop.timezone);
    const pre = await availabilityInput(tx, shopId, input.serviceId, date, 1, input.staffId);
    const candidates = pre.links.map((l) => l.staff.id);
    if (candidates.length === 0) throw conflict("no_staff", "no staff offers this service");
    await lockStaff(tx, candidates);

    // recompute *after* taking the locks so we see bookings committed while we waited
    const { query, service: svc, links } = await availabilityInput(tx, shopId, input.serviceId, date, 1, input.staffId);
    if (opts.byShop) {
      query.minNoticeMin = 0;
      query.maxAdvanceDays = 3650;
      query.now = Math.min(query.now, startsAtMs);
    }
    const slot = computeSlots(query)[0]?.slots.find((s) => new Date(s.startsAt).getTime() === startsAtMs);
    if (!slot) throw conflict("slot_unavailable", "this time is no longer available");

    let staffId = input.staffId;
    if (!staffId) {
      const dayStart = zonedToUtc(date, 0, shop.timezone);
      const counts = await tx
        .select({ staffId: appointments.staffId, n: sql<number>`count(*)::int` })
        .from(appointments)
        .where(
          and(
            inArray(appointments.staffId, slot.staffIds),
            inArray(appointments.status, BLOCKING_APPOINTMENT_STATUSES),
            gte(appointments.startsAt, dayStart),
            lt(appointments.startsAt, new Date(dayStart.getTime() + 1440 * MIN)),
          ),
        )
        .groupBy(appointments.staffId);
      staffId = pickStaff(slot.staffIds, new Map(counts.map((c) => [c.staffId, c.n])));
    } else if (!slot.staffIds.includes(staffId)) {
      throw conflict("slot_unavailable", "this staff member is not free at that time");
    }
    const link = links.find((l) => l.staff.id === staffId)!;

    const durationMin = link.durationOverride ?? svc.durationMin;
    const price = link.priceOverride ?? svc.price;
    let discountTotal = 0;
    if (input.discountCode) discountTotal = (await evaluateDiscount(tx, shopId, input.discountCode, price, "appointments")).amount;
    const payable = price - discountTotal;
    const deposit = planHas(shop.plan, "appointment_deposits") && !opts.byShop ? depositFor(payable, svc.deposit) : 0;

    const customer = await upsertCustomer(tx, shopId, { phone: input.customer.phone, name: input.customer.name, instagramId: input.customer.instagramId });
    const endsAt = new Date(startsAtMs + durationMin * MIN);
    const needsApproval = svc.requiresApproval || !settings.booking.autoConfirm;
    const status: AppointmentStatus = opts.byShop ? "confirmed" : deposit > 0 || needsApproval ? "pending" : "confirmed";

    const [appt] = await tx
      .insert(appointments)
      .values({
        shopId,
        code: bookingCode(),
        accessToken: randomToken(18),
        serviceId: svc.id,
        staffId: staffId!,
        customerId: customer!.id,
        startsAt: input.startsAt,
        endsAt,
        blockStart: new Date(startsAtMs - svc.bufferBeforeMin * MIN),
        blockEnd: new Date(endsAt.getTime() + svc.bufferAfterMin * MIN),
        status,
        channel: input.channel,
        price,
        discountCode: input.discountCode?.toUpperCase(),
        discountTotal,
        depositAmount: deposit,
        note: input.note,
        confirmedAt: status === "confirmed" ? new Date() : null,
        holdUntil: deposit > 0 ? new Date(Date.now() + DEPOSIT_HOLD_MIN * MIN) : null,
        conversationId: opts.conversationId ?? null,
      })
      .returning();
    if (input.discountCode && deposit === 0) await consumeDiscount(tx, shopId, input.discountCode.toUpperCase());
    await audit(tx, shopId, actor, "appointment.create", "appointment", appt!.id, { status, deposit });
    return { appointment: appt!, settings, service: svc };
  });

  await scheduleAppointmentJobs(queues, result.appointment, result.settings);
  if (result.appointment.status === "confirmed" || result.appointment.depositAmount === 0) {
    await queues.add("notify.appointment-booked", { appointmentId: result.appointment.id });
  }
  return result.appointment;
}

export async function scheduleAppointmentJobs(queues: Queues, appt: typeof appointments.$inferSelect, settings: ShopSettings) {
  const jobs: Promise<unknown>[] = [];
  if (appt.holdUntil) jobs.push(queues.at("appointment.hold-expire", { appointmentId: appt.id }, appt.holdUntil, `appt-hold-${appt.id}`));
  for (const offset of settings.booking.reminderOffsetsMin) {
    const at = new Date(appt.startsAt.getTime() - offset * MIN);
    if (at.getTime() > Date.now()) {
      jobs.push(queues.at("appointment.reminder", { appointmentId: appt.id, offsetMin: offset }, at, `appt-rem-${appt.id}-${offset}-${appt.startsAt.getTime()}`));
    }
  }
  await Promise.all(jobs);
}

export async function rescheduleAppointment(db: Database, queues: Queues, shopId: string, appointmentId: string, to: { startsAt: Date; staffId?: string }, actor: Actor, byShop: boolean) {
  const current = await db.query.appointments.findFirst({ where: and(eq(appointments.id, appointmentId), eq(appointments.shopId, shopId)) });
  if (!current) throw notFound("appointment");
  if (!BLOCKING_APPOINTMENT_STATUSES.includes(current.status)) throw conflict("not_reschedulable", `cannot reschedule a ${current.status} appointment`);

  const updated = await db.transaction(async (tx) => {
    const { shop, settings } = await loadShop(tx, shopId);
    if (!byShop && current.startsAt.getTime() - Date.now() < settings.booking.cancelWindowMin * MIN) {
      throw conflict("too_late", "it is too late to change this appointment");
    }
    const staffId = to.staffId ?? current.staffId;
    await lockStaff(tx, [staffId]);
    // free the current slot inside this transaction, then validate the new one like a fresh booking
    await tx.update(appointments).set({ status: "cancelled" }).where(eq(appointments.id, current.id));
    const date = zonedIsoDate(to.startsAt, shop.timezone);
    const { query, service: svc, links } = await availabilityInput(tx, shopId, current.serviceId, date, 1, staffId);
    if (byShop) {
      query.minNoticeMin = 0;
      query.maxAdvanceDays = 3650;
    }
    const slot = computeSlots(query)[0]?.slots.find((s) => new Date(s.startsAt).getTime() === to.startsAt.getTime());
    if (!slot || !slot.staffIds.includes(staffId)) throw conflict("slot_unavailable", "this time is not available");
    const durationMin = links[0]?.durationOverride ?? svc.durationMin;
    const endsAt = new Date(to.startsAt.getTime() + durationMin * MIN);
    const [row] = await tx
      .update(appointments)
      .set({
        status: current.status,
        staffId,
        startsAt: to.startsAt,
        endsAt,
        blockStart: new Date(to.startsAt.getTime() - svc.bufferBeforeMin * MIN),
        blockEnd: new Date(endsAt.getTime() + svc.bufferAfterMin * MIN),
      })
      .where(eq(appointments.id, current.id))
      .returning();
    await audit(tx, shopId, actor, "appointment.reschedule", "appointment", current.id, { from: current.startsAt, to: to.startsAt, staffId });
    return { appt: row!, settings };
  });
  await scheduleAppointmentJobs(queues, updated.appt, updated.settings);
  return updated.appt;
}

export async function transitionAppointment(
  db: Database,
  queues: Queues,
  shopId: string,
  appointmentId: string,
  to: AppointmentStatus,
  actor: Actor,
  reason?: string,
  cancelledBy: "customer" | "shop" | "system" = "shop",
) {
  const result = await db.transaction(async (tx) => {
    const [a] = await tx.select().from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.shopId, shopId))).for("update");
    if (!a) throw notFound("appointment");
    if (a.status === to) return { appt: a, changed: false };
    if (!APPOINTMENT_TRANSITIONS[a.status].includes(to)) throw conflict("invalid_transition", `cannot move from ${a.status} to ${to}`);

    const now = new Date();
    const [row] = await tx
      .update(appointments)
      .set({
        status: to,
        ...(to === "confirmed" ? { confirmedAt: now, holdUntil: null } : {}),
        ...(to === "checked_in" ? { checkedInAt: now } : {}),
        ...(to === "completed" ? { completedAt: now } : {}),
        ...(to === "cancelled" ? { cancelledAt: now, cancelReason: reason, cancelledBy } : {}),
      })
      .where(eq(appointments.id, a.id))
      .returning();

    if (to === "completed") {
      const { settings } = await loadShop(tx, shopId);
      await recordPurchase(tx, shopId, a.customerId, a.price - a.discountTotal, settings, { type: "appointment", id: a.id });
    }
    if (to === "no_show") {
      await tx.update(customers).set({ noShowCount: sql`${customers.noShowCount} + 1` }).where(eq(customers.id, a.customerId));
    }
    await audit(tx, shopId, actor, `appointment.${to}`, "appointment", a.id, { reason });
    return { appt: row!, changed: true };
  });
  if (result.changed && to === "cancelled") await queues.add("notify.appointment-cancelled", { appointmentId });
  if (result.changed && to === "confirmed") await queues.add("notify.appointment-booked", { appointmentId });
  return result.appt;
}

/** Deposit or full payment received for an appointment. Idempotent. */
export async function markAppointmentPaid(tx: Tx, appointmentId: string, amount: number) {
  const [a] = await tx.select().from(appointments).where(eq(appointments.id, appointmentId)).for("update");
  if (!a) throw notFound("appointment");
  if (a.paymentStatus === "paid") return { appt: a, alreadyPaid: true };
  const svc = await tx.query.services.findFirst({ where: eq(services.id, a.serviceId) });
  const { settings } = await loadShop(tx, a.shopId);
  const needsApproval = Boolean(svc?.requiresApproval) || !settings.booking.autoConfirm;
  const status: AppointmentStatus = a.status === "pending" && !needsApproval ? "confirmed" : a.status;
  const [row] = await tx
    .update(appointments)
    .set({
      paidAmount: sql`${appointments.paidAmount} + ${amount}`,
      paymentStatus: "paid",
      holdUntil: null,
      status,
      confirmedAt: status === "confirmed" && !a.confirmedAt ? new Date() : a.confirmedAt,
    })
    .where(eq(appointments.id, a.id))
    .returning();
  if (a.discountCode) await consumeDiscount(tx, a.shopId, a.discountCode);
  return { appt: row!, alreadyPaid: false };
}

/** Unpaid deposit holds release their slot after the hold window. */
export async function expireHoldIfDue(db: Database, appointmentId: string) {
  const [row] = await db
    .update(appointments)
    .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: "deposit not paid", cancelledBy: "system", holdUntil: null })
    .where(
      and(
        eq(appointments.id, appointmentId),
        eq(appointments.status, "pending"),
        ne(appointments.paymentStatus, "paid"),
        lt(appointments.holdUntil, new Date()),
      ),
    )
    .returning({ id: appointments.id });
  return Boolean(row);
}

export async function calendar(db: DbOrTx, shopId: string, from: Date, to: Date, staffIds?: string[], opts: { refundRequested?: boolean } = {}) {
  const rows = await db
    .select({
      appt: appointments,
      serviceName: services.name,
      serviceColor: services.color,
      staffName: staff.name,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerSegment: customers.segment,
      customerNoShows: customers.noShowCount,
    })
    .from(appointments)
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(staff, eq(staff.id, appointments.staffId))
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .where(
      opts.refundRequested
        ? and(eq(appointments.shopId, shopId), eq(appointments.refundStatus, "requested"))
        : and(
            eq(appointments.shopId, shopId),
            lt(appointments.startsAt, to),
            gte(appointments.endsAt, from),
            staffIds?.length ? inArray(appointments.staffId, staffIds) : undefined,
          ),
    )
    .orderBy(appointments.startsAt)
    .limit(opts.refundRequested ? 100 : 2000);
  const blocks = await db
    .select()
    .from(timeOff)
    .where(
      and(
        eq(timeOff.shopId, shopId),
        lt(timeOff.startsAt, to),
        gte(timeOff.endsAt, from),
        staffIds?.length ? or(isNull(timeOff.staffId), inArray(timeOff.staffId, staffIds)) : undefined,
      ),
    );
  return {
    appointments: rows.map((r) => ({
      ...r.appt,
      service: { name: r.serviceName, color: r.serviceColor },
      staff: { name: r.staffName },
      customer: { name: r.customerName, phone: r.customerPhone, segment: r.customerSegment, noShowCount: r.customerNoShows },
    })),
    timeOff: blocks,
  };
}

/**
 * Offline / walk-in booking by the shop: any start time (defaults to now), optionally outside working
 * hours. The only hard rule kept is "no double booking" for the staff member (capacity-aware).
 */
export async function bookWalkIn(
  db: Database,
  queues: Queues,
  shopId: string,
  input: { serviceId: string; staffId: string; startsAt?: Date; customer: { phone: string; name: string }; note?: string; outsideHours: boolean },
  actor: Actor,
) {
  const startsAt = input.startsAt ?? new Date(Math.floor(Date.now() / (5 * MIN)) * 5 * MIN);
  const appt = await db.transaction(async (tx) => {
    const { shop, settings } = await loadShop(tx, shopId);
    const svc = await loadService(tx, shopId, input.serviceId);
    const link = await tx.query.staffServices.findFirst({ where: and(eq(staffServices.staffId, input.staffId), eq(staffServices.serviceId, svc.id)) });
    const member = await tx.query.staff.findFirst({ where: and(eq(staff.id, input.staffId), eq(staff.shopId, shopId)) });
    if (!member) throw notFound("staff");
    await lockStaff(tx, [member.id]);

    const durationMin = link?.durationOverride ?? svc.durationMin;
    const endsAt = new Date(startsAt.getTime() + durationMin * MIN);
    const blockStart = new Date(startsAt.getTime() - svc.bufferBeforeMin * MIN);
    const blockEnd = new Date(endsAt.getTime() + svc.bufferAfterMin * MIN);

    if (!input.outsideHours) {
      const date = zonedIsoDate(startsAt, shop.timezone);
      const dayStart = zonedToUtc(date, 0, shop.timezone).getTime();
      const startMin = (startsAt.getTime() - dayStart) / MIN;
      const hours = await tx.select().from(workingHours).where(eq(workingHours.staffId, member.id));
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      const inside = hours.some((h) => h.weekday === weekday && startMin >= h.startMin && startMin + durationMin <= h.endMin);
      if (!inside) throw conflict("outside_hours", "outside this staff member's working hours");
    }

    const overlapping = await tx
      .select({ serviceId: appointments.serviceId, startsAt: appointments.startsAt })
      .from(appointments)
      .where(
        and(
          eq(appointments.staffId, member.id),
          inArray(appointments.status, BLOCKING_APPOINTMENT_STATUSES),
          lt(appointments.blockStart, blockEnd),
          gt(appointments.blockEnd, blockStart),
        ),
      );
    const sameSession = overlapping.filter((o) => o.serviceId === svc.id && o.startsAt.getTime() === startsAt.getTime());
    const conflicts = overlapping.length - sameSession.length;
    if (conflicts > 0 || sameSession.length >= svc.capacity) throw conflict("slot_unavailable", "this staff member is busy at that time");

    const customer = await upsertCustomer(tx, shopId, input.customer);
    const [row] = await tx
      .insert(appointments)
      .values({
        shopId,
        code: bookingCode(),
        accessToken: randomToken(18),
        serviceId: svc.id,
        staffId: member.id,
        customerId: customer!.id,
        startsAt,
        endsAt,
        blockStart,
        blockEnd,
        status: startsAt.getTime() <= Date.now() + 5 * MIN ? "checked_in" : "confirmed",
        channel: "pos",
        price: link?.priceOverride ?? svc.price,
        note: input.note,
        confirmedAt: new Date(),
        checkedInAt: startsAt.getTime() <= Date.now() + 5 * MIN ? new Date() : null,
      })
      .returning();
    await audit(tx, shopId, actor, "appointment.walk_in", "appointment", row!.id);
    return { appt: row!, settings };
  });
  await scheduleAppointmentJobs(queues, appt.appt, appt.settings);
  return appt.appt;
}
