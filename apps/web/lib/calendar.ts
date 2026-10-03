import { addDaysIso, isoToJalali, jalaliMonthLength, jalaliToIso, weekdayOfIso } from "@shopino/shared";
import type { Locale } from "./i18n";

const FA_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
export const WEEK_HEAD: Record<Locale, string[]> = {
  fa: ["ش", "ی", "د", "س", "چ", "پ", "ج"],
  en: ["Sa", "Su", "Mo", "Tu", "We", "Th", "Fr"],
};

export const faDigits = (v: number | string) => String(v).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]!);

export interface MonthInfo {
  first: string;
  length: number;
  label: string;
  /** blank cells before day 1, weeks start on Saturday */
  lead: number;
  prev: string;
  next: string;
  days: string[];
}

/** The month (Jalali for fa, Gregorian for en) that contains `iso`. */
export function monthOf(iso: string, locale: Locale): MonthInfo {
  let first: string;
  let length: number;
  let label: string;
  if (locale === "fa") {
    const j = isoToJalali(iso);
    first = jalaliToIso(j.jy, j.jm, 1);
    length = jalaliMonthLength(j.jy, j.jm);
    label = `${FA_MONTHS[j.jm - 1]} ${faDigits(j.jy)}`;
  } else {
    const [y, m] = iso.split("-").map(Number) as [number, number];
    first = `${iso.slice(0, 8)}01`;
    length = new Date(Date.UTC(y, m, 0)).getUTCDate();
    label = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${first}T12:00:00Z`));
  }
  return {
    first,
    length,
    label,
    lead: (weekdayOfIso(first) + 1) % 7,
    prev: addDaysIso(first, -1),
    next: addDaysIso(first, length),
    days: Array.from({ length }, (_, i) => addDaysIso(first, i)),
  };
}
