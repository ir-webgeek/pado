import type { Locale } from "./i18n";

export const TZ_DEFAULT = "Asia/Tehran";

export function money(n: number | string | null | undefined, locale: Locale, withUnit = true) {
  const v = new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US").format(Number(n ?? 0));
  if (!withUnit) return v;
  return locale === "fa" ? `${v} تومان` : `${v} T`;
}

export function num(n: number | string | null | undefined, locale: Locale) {
  return new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US").format(Number(n ?? 0));
}

const calLocale = (l: Locale) => (l === "fa" ? "fa-IR-u-ca-persian" : "en-GB");

export function date(d: string | Date | null | undefined, locale: Locale, tz = TZ_DEFAULT, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) {
  if (!d) return "-";
  return new Intl.DateTimeFormat(calLocale(locale), { timeZone: tz, ...opts }).format(new Date(d));
}

export function time(d: string | Date, locale: Locale, tz = TZ_DEFAULT) {
  return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(d));
}

export function dateTime(d: string | Date | null | undefined, locale: Locale, tz = TZ_DEFAULT) {
  if (!d) return "-";
  return new Intl.DateTimeFormat(calLocale(locale), { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(d));
}

export function weekdayShort(isoDate: string, locale: Locale) {
  return new Intl.DateTimeFormat(calLocale(locale), { timeZone: "UTC", weekday: "short" }).format(new Date(`${isoDate}T12:00:00Z`));
}

export function dayLabel(isoDate: string, locale: Locale) {
  return new Intl.DateTimeFormat(calLocale(locale), { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${isoDate}T12:00:00Z`));
}

export function relative(d: string | Date, locale: Locale) {
  const diff = (new Date(d).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale === "fa" ? "fa" : "en", { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

/** Convert Persian/Arabic digits typed by users to latin digits before sending to the API. */
export function latinDigits(s: string) {
  return s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}
