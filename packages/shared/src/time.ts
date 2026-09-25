/**
 * Timezone helpers built on Intl only (no dependency). Business hours are stored as
 * minutes-from-midnight in the shop's IANA timezone; bookings are stored as UTC instants.
 */

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = dtf(timeZone).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAYS[get("weekday")] ?? 0,
  };
}

/** Offset of `timeZone` from UTC at instant `date`, in minutes (Tehran = +210). */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - (date.getTime() - date.getMilliseconds())) / 60_000);
}

/** Convert a wall-clock time in `timeZone` to a UTC Date. `isoDate` is YYYY-MM-DD. */
export function zonedToUtc(isoDate: string, minutesOfDay: number, timeZone: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const guess = new Date(Date.UTC(y, m - 1, d, 0, minutesOfDay));
  // two passes handle DST edges
  let offset = tzOffsetMinutes(guess, timeZone);
  let result = new Date(guess.getTime() - offset * 60_000);
  const offset2 = tzOffsetMinutes(result, timeZone);
  if (offset2 !== offset) {
    offset = offset2;
    result = new Date(guess.getTime() - offset * 60_000);
  }
  return result;
}

/** YYYY-MM-DD of `date` as seen in `timeZone`. */
export function zonedIsoDate(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function weekdayOfIso(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function minutesToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** Persian (Jalali) calendar display using the platform's ICU data. */
export function formatJalali(date: Date | string, opts: Intl.DateTimeFormatOptions = {}, timeZone = "Asia/Tehran"): string {
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone, dateStyle: "medium", ...opts }).format(
    typeof date === "string" ? new Date(date) : date,
  );
}
