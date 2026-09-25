import { describe, expect, it } from "vitest";
import { computeSegment, vipProgress } from "./segments";

const rules = { vipRule: { minOrders: 3, minSpend: 5_000_000, withinDays: 30 }, atRiskDays: 90 };
const now = new Date("2026-09-24T00:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000);
const base = { ordersCount: 0, appointmentsCount: 0, totalSpent: 0, lastOrderAt: null, lastVisitAt: null, createdAt: daysAgo(400) };

describe("computeSegment", () => {
  it("new when no activity", () => expect(computeSegment(base, rules, now)).toBe("new"));
  it("vip needs count, spend and recency", () => {
    expect(computeSegment({ ...base, ordersCount: 3, totalSpent: 6_000_000, lastOrderAt: daysAgo(5) }, rules, now)).toBe("vip");
    expect(computeSegment({ ...base, ordersCount: 3, totalSpent: 6_000_000, lastOrderAt: daysAgo(45) }, rules, now)).toBe("regular");
  });
  it("visits count towards vip", () => {
    expect(computeSegment({ ...base, ordersCount: 1, appointmentsCount: 2, totalSpent: 5_000_000, lastVisitAt: daysAgo(2) }, rules, now)).toBe("vip");
  });
  it("at risk and lost by inactivity", () => {
    expect(computeSegment({ ...base, ordersCount: 2, totalSpent: 1, lastOrderAt: daysAgo(100) }, rules, now)).toBe("at_risk");
    expect(computeSegment({ ...base, ordersCount: 2, totalSpent: 1, lastOrderAt: daysAgo(200) }, rules, now)).toBe("lost");
  });
  it("new customer with one fresh order", () => {
    expect(computeSegment({ ...base, ordersCount: 1, totalSpent: 1, lastOrderAt: daysAgo(1), createdAt: daysAgo(3) }, rules, now)).toBe("new");
  });
  it("vip progress", () => {
    expect(vipProgress({ ...base, ordersCount: 3, totalSpent: 2_500_000 }, rules)).toBe(0.75);
  });
});
