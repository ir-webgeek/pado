import { describe, expect, it } from "vitest";
import { addDaysIso, tzOffsetMinutes, weekdayOfIso, zonedIsoDate, zonedToUtc } from "./time";
import { normalizeIranPhone } from "./codes";

describe("time", () => {
  it("Tehran offset is +03:30", () => {
    expect(tzOffsetMinutes(new Date("2026-09-24T12:00:00Z"), "Asia/Tehran")).toBe(210);
  });
  it("converts wall clock to UTC", () => {
    expect(zonedToUtc("2026-09-24", 10 * 60, "Asia/Tehran").toISOString()).toBe("2026-09-24T06:30:00.000Z");
    expect(zonedToUtc("2026-01-10", 9 * 60, "Europe/Berlin").toISOString()).toBe("2026-01-10T08:00:00.000Z");
    expect(zonedToUtc("2026-07-10", 9 * 60, "Europe/Berlin").toISOString()).toBe("2026-07-10T07:00:00.000Z");
  });
  it("zoned iso date crosses midnight correctly", () => {
    expect(zonedIsoDate(new Date("2026-09-24T21:00:00Z"), "Asia/Tehran")).toBe("2026-09-25");
  });
  it("date arithmetic", () => {
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekdayOfIso("2026-09-26")).toBe(6); // Saturday
  });
});

describe("phone", () => {
  it("normalizes Iranian mobile numbers", () => {
    expect(normalizeIranPhone("09121234567")).toBe("+989121234567");
    expect(normalizeIranPhone("۰۹۱۲۱۲۳۴۵۶۷")).toBe("+989121234567");
    expect(normalizeIranPhone("+98 912 123 4567")).toBe("+989121234567");
    expect(normalizeIranPhone("12345")).toBeNull();
  });
});
