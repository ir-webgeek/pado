import { describe, expect, it } from "vitest";
import { zonedToUtc } from "@shopino/shared";
import { computeSlots, pickStaff, type SlotQuery } from "./slots";

const TZ = "Asia/Tehran";
const DATE = "2026-09-26"; // Saturday
const at = (min: number) => zonedToUtc(DATE, min, TZ).getTime();
const hhmm = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

function query(over: Partial<SlotQuery> = {}): SlotQuery {
  return {
    timezone: TZ,
    fromDate: DATE,
    days: 1,
    service: { id: "svc", durationMin: 60, bufferBeforeMin: 0, bufferAfterMin: 0, capacity: 1 },
    staff: [{ staffId: "a", hours: [{ weekday: 6, startMin: 600, endMin: 780 }], busy: [], timeOff: [] }],
    shopTimeOff: [],
    stepMin: 30,
    minNoticeMin: 0,
    maxAdvanceDays: 60,
    now: at(0) - 86400_000,
    ...over,
  };
}

describe("computeSlots", () => {
  it("fills working hours at the step size and keeps the service inside hours", () => {
    const [day] = computeSlots(query());
    expect(day!.slots.map((s) => hhmm(s.startsAt))).toEqual(["10:00", "10:30", "11:00", "11:30", "12:00"]);
  });

  it("returns nothing on days without hours", () => {
    expect(computeSlots(query({ fromDate: "2026-09-25" }))[0]!.slots).toEqual([]); // Friday
  });

  it("blocks existing bookings including buffers", () => {
    const q = query({
      service: { id: "svc", durationMin: 60, bufferBeforeMin: 0, bufferAfterMin: 15, capacity: 1 },
      staff: [{ staffId: "a", hours: [{ weekday: 6, startMin: 600, endMin: 780 }], busy: [{ serviceId: "x", startsAt: at(660), start: at(660), end: at(720) }], timeOff: [] }],
    });
    // 10:00 block ends 11:15 -> overlaps 11:00 booking; 12:00 block (12:00-13:15) is free
    expect(computeSlots(q)[0]!.slots.map((s) => hhmm(s.startsAt))).toEqual(["12:00"]);
  });

  it("respects minimum notice", () => {
    const q = query({ now: at(600), minNoticeMin: 90 });
    expect(computeSlots(q)[0]!.slots.map((s) => hhmm(s.startsAt))).toEqual(["11:30", "12:00"]);
  });

  it("respects staff and shop time off", () => {
    const q = query({ shopTimeOff: [{ start: at(600), end: at(690) }] });
    expect(computeSlots(q)[0]!.slots.map((s) => hhmm(s.startsAt))).toEqual(["11:30", "12:00"]);
  });

  it("merges staff and lists who is free", () => {
    const q = query({
      staff: [
        { staffId: "a", hours: [{ weekday: 6, startMin: 600, endMin: 660 }], busy: [], timeOff: [] },
        { staffId: "b", hours: [{ weekday: 6, startMin: 600, endMin: 720 }], busy: [], timeOff: [] },
      ],
    });
    const slots = computeSlots(q)[0]!.slots;
    expect(slots[0]!.staffIds).toEqual(["a", "b"]);
    expect(slots.map((s) => hhmm(s.startsAt))).toEqual(["10:00", "10:30", "11:00"]);
  });

  it("lets group sessions fill up to capacity", () => {
    const service = { id: "class", durationMin: 60, bufferBeforeMin: 0, bufferAfterMin: 0, capacity: 2 };
    const one = { serviceId: "class", startsAt: at(600), start: at(600), end: at(660) };
    const q1 = query({ service, staff: [{ staffId: "a", hours: [{ weekday: 6, startMin: 600, endMin: 660 }], busy: [one], timeOff: [] }] });
    expect(computeSlots(q1)[0]!.slots).toEqual([{ startsAt: new Date(at(600)).toISOString(), staffIds: ["a"], seatsLeft: 1 }]);
    const q2 = query({ service, staff: [{ staffId: "a", hours: [{ weekday: 6, startMin: 600, endMin: 660 }], busy: [one, { ...one }], timeOff: [] }] });
    expect(computeSlots(q2)[0]!.slots).toEqual([]);
  });
});

describe("pickStaff", () => {
  it("prefers the least busy staff member", () => {
    expect(pickStaff(["a", "b"], new Map([["a", 3], ["b", 1]]))).toBe("b");
  });
});
