import { and, eq, sql } from "drizzle-orm";
import { customers, loyaltyLedger, type DbOrTx, type ShopSettings } from "@shopino/db";
import { normalizeIranPhone, pointsFor } from "@shopino/shared";
import { badRequest } from "../../lib/errors";
import { computeSegment } from "./segments";

export interface CustomerIdentity {
  phone?: string | null;
  name?: string | null;
  instagramId?: string | null;
  instagramUsername?: string | null;
}

/** Find a customer by phone or Instagram id, creating or enriching as needed. */
export async function upsertCustomer(db: DbOrTx, shopId: string, who: CustomerIdentity) {
  const phone = who.phone ? normalizeIranPhone(who.phone) : null;
  if (who.phone && !phone) throw badRequest("invalid_phone", "enter a valid mobile number");
  if (!phone && !who.instagramId) return null;

  const byPhone = phone ? await db.query.customers.findFirst({ where: and(eq(customers.shopId, shopId), eq(customers.phone, phone)) }) : undefined;
  const byIg =
    who.instagramId && !byPhone
      ? await db.query.customers.findFirst({ where: and(eq(customers.shopId, shopId), eq(customers.instagramId, who.instagramId)) })
      : undefined;
  const existing = byPhone ?? byIg;

  if (existing) {
    const patch: Partial<typeof customers.$inferInsert> = {};
    if (phone && !existing.phone) patch.phone = phone;
    if (who.name && !existing.name) patch.name = who.name;
    if (who.instagramId && !existing.instagramId) patch.instagramId = who.instagramId;
    if (who.instagramUsername && !existing.instagramUsername) patch.instagramUsername = who.instagramUsername;
    if (Object.keys(patch).length) {
      const [updated] = await db.update(customers).set(patch).where(eq(customers.id, existing.id)).returning();
      return updated!;
    }
    return existing;
  }
  const [created] = await db
    .insert(customers)
    .values({ shopId, phone, name: who.name ?? null, instagramId: who.instagramId ?? null, instagramUsername: who.instagramUsername ?? null })
    .returning();
  return created!;
}

export async function recomputeSegment(db: DbOrTx, customerId: string, settings: Pick<ShopSettings, "vipRule" | "atRiskDays">) {
  const c = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
  if (!c) return;
  const segment = computeSegment(c, settings);
  if (segment !== c.segment) await db.update(customers).set({ segment }).where(eq(customers.id, c.id));
}

/** Record a paid purchase (order) on the customer profile and earn loyalty points. */
export async function recordPurchase(
  db: DbOrTx,
  shopId: string,
  customerId: string,
  amount: number,
  settings: ShopSettings,
  ref: { type: "order" | "appointment"; id: string },
) {
  const isVisit = ref.type === "appointment";
  await db
    .update(customers)
    .set(
      isVisit
        ? { appointmentsCount: sql`${customers.appointmentsCount} + 1`, totalSpent: sql`${customers.totalSpent} + ${amount}`, lastVisitAt: new Date() }
        : { ordersCount: sql`${customers.ordersCount} + 1`, totalSpent: sql`${customers.totalSpent} + ${amount}`, lastOrderAt: new Date() },
    )
    .where(eq(customers.id, customerId));

  if (settings.loyalty.enabled) {
    const pts = pointsFor(amount, settings.loyalty.tomanPerPoint);
    if (pts > 0) await changePoints(db, shopId, customerId, pts, "earn", ref, settings.loyalty.expiryDays);
  }
  await recomputeSegment(db, customerId, settings);
}

export async function reversePurchase(db: DbOrTx, shopId: string, customerId: string, amount: number, ref: { type: "order" | "appointment"; id: string }) {
  const isVisit = ref.type === "appointment";
  await db
    .update(customers)
    .set(
      isVisit
        ? { appointmentsCount: sql`greatest(${customers.appointmentsCount} - 1, 0)`, totalSpent: sql`greatest(${customers.totalSpent} - ${amount}, 0)` }
        : { ordersCount: sql`greatest(${customers.ordersCount} - 1, 0)`, totalSpent: sql`greatest(${customers.totalSpent} - ${amount}, 0)` },
    )
    .where(eq(customers.id, customerId));
  // give back points that were spent and take back points that were earned on this ref
  const rows = await db
    .select({ delta: sql<number>`coalesce(sum(${loyaltyLedger.delta}), 0)::int` })
    .from(loyaltyLedger)
    .where(and(eq(loyaltyLedger.customerId, customerId), eq(loyaltyLedger.refType, ref.type), eq(loyaltyLedger.refId, ref.id)));
  const net = rows[0]?.delta ?? 0;
  if (net !== 0) await changePoints(db, shopId, customerId, -net, "reverse", ref);
}

export async function changePoints(
  db: DbOrTx,
  shopId: string,
  customerId: string,
  delta: number,
  reason: "earn" | "redeem" | "reverse" | "expire" | "adjust",
  ref?: { type: string; id: string },
  expiryDays?: number,
) {
  const [row] = await db
    .update(customers)
    .set({ points: sql`greatest(${customers.points} + ${delta}, 0)` })
    .where(and(eq(customers.id, customerId), delta < 0 && reason === "redeem" ? sql`${customers.points} >= ${-delta}` : undefined))
    .returning({ points: customers.points });
  if (!row) throw badRequest("insufficient_points");
  await db.insert(loyaltyLedger).values({
    shopId,
    customerId,
    delta,
    reason,
    refType: ref?.type,
    refId: ref?.id,
    expiresAt: expiryDays && delta > 0 ? new Date(Date.now() + expiryDays * 86400_000) : null,
  });
  return row.points;
}
