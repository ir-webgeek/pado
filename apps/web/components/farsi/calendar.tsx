"use client";

// Calendar built on FarsiUI's Persian DayPicker (github.com/MiladJoodi/FarsiUI, MIT), styled with this
// app's tokens instead of shadcn's. Jalali + RTL + Persian digits for fa; plain Gregorian for en.
import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { DayPicker as GregorianDayPicker, getDefaultClassNames, type DayButtonProps } from "react-day-picker";
import { DayPicker as PersianDayPicker } from "./day-picker-persian";

/** "YYYY-MM-DD" <-> Date at local noon (no timezone drift around midnight). */
export const isoToDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12);
};
export const dateToIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface ShamsiCalendarProps {
  locale: "fa" | "en";
  selected?: string;
  /** month shown (any day in it); controlled when given with onMonthChange */
  month?: string;
  onMonthChange?: (iso: string) => void;
  today?: string;
  min?: string;
  max?: string;
  onPick: (iso: string) => void;
  /** extra content under the day number (e.g. booking counts) */
  renderDay?: (iso: string) => ReactNode;
  /** taller cells for month views */
  size?: "sm" | "lg";
  /** the page draws its own month title and arrows */
  hideHeader?: boolean;
  className?: string;
}

export function ShamsiCalendar({ locale, selected, month, onMonthChange, today, min, max, onPick, renderDay, size = "sm", hideHeader, className }: ShamsiCalendarProps) {
  const d = getDefaultClassNames();
  const disabled = [...(min ? [{ before: isoToDate(min) }] : []), ...(max ? [{ after: isoToDate(max) }] : [])];
  const common = {
    mode: "single" as const,
    selected: selected ? isoToDate(selected) : undefined,
    onSelect: (date: Date | undefined) => date && onPick(dateToIso(date)),
    month: month ? isoToDate(month) : undefined,
    onMonthChange: onMonthChange ? (m: Date) => onMonthChange(dateToIso(m)) : undefined,
    today: today ? isoToDate(today) : undefined,
    disabled,
    showOutsideDays: false,
    hideNavigation: hideHeader,
    className: clsx("w-full", className),
    classNames: {
      root: clsx("w-full", d.root),
      months: clsx("relative flex flex-col", d.months),
      month: clsx("flex w-full flex-col gap-2", d.month),
      nav: clsx("absolute inset-x-0 top-0 flex items-center justify-between", d.nav),
      button_previous: clsx("rounded-full p-1.5 hover:bg-[var(--surface-sunken)] aria-disabled:opacity-40", d.button_previous),
      button_next: clsx("rounded-full p-1.5 hover:bg-[var(--surface-sunken)] aria-disabled:opacity-40", d.button_next),
      month_caption: clsx(hideHeader ? "hidden" : "flex h-8 items-center justify-center text-sm font-semibold strong", d.month_caption),
      caption_label: clsx("num select-none", d.caption_label),
      month_grid: clsx("w-full border-collapse", d.month_grid),
      weekdays: clsx("flex", d.weekdays),
      weekday: clsx("flex-1 py-1 text-center text-[11px] font-medium muted select-none [&:last-child]:text-danger/80", d.weekday),
      week: clsx("mt-1 flex w-full gap-1", d.week),
      day: clsx("relative flex-1 p-0 text-center", d.day),
      today: "",
      outside: "opacity-0",
      disabled: "pointer-events-none opacity-30",
      hidden: "invisible",
    },
    components: {
      Chevron: ({ orientation }: { orientation?: "up" | "down" | "left" | "right" }) =>
        orientation === "left" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />,
      DayButton: (props: DayButtonProps) => <DayCell {...props} renderDay={renderDay} size={size} />,
    },
  };
  return locale === "fa" ? <PersianDayPicker {...common} dir="rtl" /> : <GregorianDayPicker {...common} weekStartsOn={6} dir="ltr" />;
}

function DayCell({ day, modifiers, renderDay, size, className, children, ...props }: DayButtonProps & { renderDay?: (iso: string) => ReactNode; size: "sm" | "lg" }) {
  const iso = dateToIso(day.date);
  const friday = day.date.getDay() === 5;
  return (
    <button
      {...props}
      type="button"
      className={clsx(
        "num flex w-full flex-col items-center rounded-xl text-sm transition disabled:pointer-events-none",
        size === "lg" ? "min-h-16 justify-start gap-1 border border-[var(--border)] pt-1.5 sm:min-h-20" : "h-9 justify-center",
        modifiers.selected ? "bg-[var(--accent)] font-semibold text-[var(--accent-ink)]" : "hover:bg-[var(--accent-soft)]",
        !modifiers.selected && modifiers.today && "ring-1 ring-gold/60",
        !modifiers.selected && friday && "text-danger/80",
        className,
      )}
    >
      <span>{children}</span>
      {renderDay?.(iso)}
    </button>
  );
}
