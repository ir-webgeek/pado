import type { CustomerSegment } from "@shopino/shared";
import type { ShopSettings } from "@shopino/db";

export interface CustomerStats {
  ordersCount: number;
  appointmentsCount: number;
  totalSpent: number;
  lastOrderAt: Date | null;
  lastVisitAt: Date | null;
  createdAt: Date;
}

const DAY = 86400_000;

/**
 * Segment purely from the customer's own history (orders and visits count the same):
 * - vip: meets the shop's VIP rule (count, spend, and recent activity - all three)
 * - lost: no activity for 2x the at-risk window
 * - at_risk: no activity for the at-risk window
 * - new: at most one purchase/visit and joined within 30 days
 * - regular: everyone else who bought
 */
export function computeSegment(s: CustomerStats, rules: Pick<ShopSettings, "vipRule" | "atRiskDays">, now = new Date()): CustomerSegment {
  const activity = s.ordersCount + s.appointmentsCount;
  const last = [s.lastOrderAt, s.lastVisitAt].filter((d): d is Date => d instanceof Date).sort((a, b) => b.getTime() - a.getTime())[0];
  const sinceLast = last ? (now.getTime() - last.getTime()) / DAY : Infinity;

  if (activity === 0) return "new";
  if (activity >= rules.vipRule.minOrders && s.totalSpent >= rules.vipRule.minSpend && sinceLast <= rules.vipRule.withinDays) return "vip";
  if (sinceLast > rules.atRiskDays * 2) return "lost";
  if (sinceLast > rules.atRiskDays) return "at_risk";
  if (activity <= 1 && (now.getTime() - s.createdAt.getTime()) / DAY <= 30) return "new";
  return "regular";
}

/** How close a customer is to VIP (0..1) - drives the "almost VIP" list. */
export function vipProgress(s: CustomerStats, rules: Pick<ShopSettings, "vipRule">): number {
  const count = Math.min(1, (s.ordersCount + s.appointmentsCount) / rules.vipRule.minOrders);
  const spend = rules.vipRule.minSpend ? Math.min(1, s.totalSpent / rules.vipRule.minSpend) : 1;
  return Math.round(((count + spend) / 2) * 100) / 100;
}
