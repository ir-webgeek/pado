import { addDaysIso, weekdayOfIso, zonedToUtc } from "@shopino/shared";

/**
 * Pure availability engine. Everything is plain data so it is trivially testable and can run
 * anywhere (API, worker, or even the browser for instant previews).
 */

export interface Interval {
  start: number; // epoch ms
  end: number;
}

export interface BusyBlock extends Interval {
  serviceId: string;
  startsAt: number;
}

export interface StaffAvailabilityInput {
  staffId: string;
  /** weekly hours in shop-local minutes */
  hours: { weekday: number; startMin: number; endMin: number }[];
  busy: BusyBlock[];
  timeOff: Interval[];
  /** per-staff overrides from staff_services */
  durationMin?: number;
}

export interface SlotQuery {
  timezone: string;
  fromDate: string; // YYYY-MM-DD in shop timezone
  days: number;
  service: { id: string; durationMin: number; bufferBeforeMin: number; bufferAfterMin: number; capacity: number };
  staff: StaffAvailabilityInput[];
  /** shop-wide closures */
  shopTimeOff: Interval[];
  stepMin: number;
  minNoticeMin: number;
  maxAdvanceDays: number;
  now: number;
}

export interface Slot {
  startsAt: string; // ISO UTC
  staffIds: string[];
  /** seats left for group services */
  seatsLeft?: number;
}

export interface DaySlots {
  date: string;
  slots: Slot[];
}

const MIN = 60_000;
const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

export function computeSlots(q: SlotQuery): DaySlots[] {
  const earliest = q.now + q.minNoticeMin * MIN;
  const latest = q.now + q.maxAdvanceDays * 1440 * MIN;
  const out: DaySlots[] = [];

  for (let d = 0; d < q.days; d++) {
    const date = addDaysIso(q.fromDate, d);
    const weekday = weekdayOfIso(date);
    const byStart = new Map<number, { staffIds: string[]; seatsLeft?: number }>();

    for (const st of q.staff) {
      const duration = (st.durationMin ?? q.service.durationMin) * MIN;
      const before = q.service.bufferBeforeMin * MIN;
      const after = q.service.bufferAfterMin * MIN;
      const blocked = [...st.timeOff, ...q.shopTimeOff];

      for (const h of st.hours.filter((x) => x.weekday === weekday)) {
        const windowStart = zonedToUtc(date, h.startMin, q.timezone).getTime();
        const windowEnd = zonedToUtc(date, h.endMin, q.timezone).getTime();

        for (let start = windowStart; start + duration <= windowEnd; start += q.stepMin * MIN) {
          if (start < earliest || start > latest) continue;
          const service: Interval = { start, end: start + duration };
          const block: Interval = { start: start - before, end: start + duration + after };
          if (blocked.some((b) => overlaps(b, service))) continue;

          // group sessions: joining an existing session of the same service at the same start
          if (q.service.capacity > 1) {
            const sameSession = st.busy.filter((b) => b.serviceId === q.service.id && b.startsAt === start);
            if (sameSession.length > 0) {
              const left = q.service.capacity - sameSession.length;
              if (left > 0 && !st.busy.some((b) => !(b.serviceId === q.service.id && b.startsAt === start) && overlaps(b, block))) {
                add(byStart, start, st.staffId, left);
              }
              continue;
            }
          }
          if (st.busy.some((b) => overlaps(b, block))) continue;
          add(byStart, start, st.staffId, q.service.capacity > 1 ? q.service.capacity : undefined);
        }
      }
    }

    const slots = [...byStart.entries()]
      .sort(([a], [b]) => a - b)
      .map(([start, v]) => ({ startsAt: new Date(start).toISOString(), staffIds: v.staffIds, ...(v.seatsLeft !== undefined ? { seatsLeft: v.seatsLeft } : {}) }));
    out.push({ date, slots });
  }
  return out;
}

function add(map: Map<number, { staffIds: string[]; seatsLeft?: number }>, start: number, staffId: string, seats?: number) {
  const cur = map.get(start);
  if (!cur) map.set(start, { staffIds: [staffId], seatsLeft: seats });
  else {
    cur.staffIds.push(staffId);
    if (seats !== undefined) cur.seatsLeft = Math.max(cur.seatsLeft ?? 0, seats);
  }
}

/** Pick the staff member with the fewest bookings that day (spreads load across the team). */
export function pickStaff(candidates: string[], bookingsPerStaff: Map<string, number>): string | undefined {
  return [...candidates].sort((a, b) => (bookingsPerStaff.get(a) ?? 0) - (bookingsPerStaff.get(b) ?? 0))[0];
}
