import { describe, expect, it } from "vitest";
import { addDaysIso, isoToJalali, jalaliMonthLength, jalaliToIso, tzOffsetMinutes, weekdayOfIso, zonedIsoDate, zonedToUtc } from "./time";
import { normalizeIranPhone } from "./codes";
import { weightedCost } from "./money";

describe("weighted cost", () => {
  it("averages new receipts into existing stock", () => {
    expect(weightedCost(10, 100_000, 10, 200_000)).toBe(150_000);
    expect(weightedCost(3, 90_000, 1, 100_000)).toBe(92_500);
  });
  it("uses the receipt cost when there is no prior cost or stock", () => {
    expect(weightedCost(5, null, 2, 70_000)).toBe(70_000);
    expect(weightedCost(0, 50_000, 4, 80_000)).toBe(80_000);
  });
});

describe("jalali", () => {
  it("converts known dates", () => {
    expect(isoToJalali("2026-03-21")).toEqual({ jy: 1405, jm: 1, jd: 1 });
    expect(isoToJalali("2026-10-02")).toEqual({ jy: 1405, jm: 7, jd: 10 });
    expect(jalaliToIso(1403, 12, 30)).toBe("2025-03-20");
    expect(jalaliToIso(1405, 7, 10)).toBe("2026-10-02");
  });
  it("round-trips every day across several years", () => {
    for (let d = "2020-01-01"; d < "2031-01-01"; d = addDaysIso(d, 1)) {
      const j = isoToJalali(d);
      expect(jalaliToIso(j.jy, j.jm, j.jd)).toBe(d);
    }
  });
  it("month lengths, including leap Esfand", () => {
    expect(jalaliMonthLength(1405, 1)).toBe(31);
    expect(jalaliMonthLength(1405, 7)).toBe(30);
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    expect(jalaliMonthLength(1404, 12)).toBe(29);
  });
});

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
