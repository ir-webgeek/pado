"use client";

import clsx from "clsx";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { zonedIsoDate } from "@shopino/shared";
import { WEEK_HEAD, faDigits, monthOf } from "@/lib/calendar";
import { date as fmtDate } from "@/lib/format";
import { useI18n } from "@/lib/locale-client";

export function MonthNav({ label, onPrev, onNext }: { label: string; onPrev: () => void; onNext: () => void }) {
  const { locale, t } = useI18n();
  const rtl = locale === "fa";
  return (
    <div className="flex items-center justify-between gap-2">
      <button type="button" className="rounded-full p-1.5 hover:bg-[var(--surface-sunken)]" onClick={onPrev} aria-label={t("a.prev")}>
        {rtl ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
      </button>
      <span className="text-sm font-semibold strong">{label}</span>
      <button type="button" className="rounded-full p-1.5 hover:bg-[var(--surface-sunken)]" onClick={onNext} aria-label={t("a.next")}>
        {rtl ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
      </button>
    </div>
  );
}

/** Saturday-first month grid. `renderDay` adds content under the day number (e.g. booking counts). */
export function MonthGrid({
  anchor,
  selected,
  today,
  min,
  max,
  onPick,
  renderDay,
  cellClassName,
}: {
  anchor: string;
  selected?: string;
  today: string;
  min?: string;
  max?: string;
  onPick: (iso: string) => void;
  renderDay?: (iso: string) => ReactNode;
  cellClassName?: string;
}) {
  const { locale } = useI18n();
  const m = monthOf(anchor, locale);
  return (
    <div className="grid grid-cols-7 gap-1 text-center">
      {WEEK_HEAD[locale].map((w, i) => (
        <span key={w} className={clsx("py-1 text-[11px] font-medium muted", i === 6 && "text-danger/80")}>
          {w}
        </span>
      ))}
      {Array.from({ length: m.lead }, (_, i) => (
        <span key={`b${i}`} />
      ))}
      {m.days.map((d, i) => {
        const disabled = (min && d < min) || (max && d > max);
        const isSel = d === selected;
        // Friday is the weekend day in Iran
        const friday = (m.lead + i) % 7 === 6;
        return (
          <button
            key={d}
            type="button"
            disabled={Boolean(disabled)}
            onClick={() => onPick(d)}
            className={clsx(
              "num flex flex-col items-center rounded-xl text-sm transition disabled:pointer-events-none disabled:opacity-30",
              isSel ? "bg-[var(--accent)] font-semibold text-[var(--accent-ink)]" : "hover:bg-[var(--accent-soft)]",
              !isSel && d === today && "ring-1 ring-gold/60",
              !isSel && friday && "text-danger/80",
              cellClassName ?? "h-9 justify-center",
            )}
          >
            <span>{locale === "fa" ? faDigits(i + 1) : i + 1}</span>
            {renderDay?.(d)}
          </button>
        );
      })}
    </div>
  );
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  tz = "Asia/Tehran",
  className,
}: {
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  tz?: string;
  className?: string;
}) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  const today = zonedIsoDate(new Date(), tz);

  useEffect(() => {
    if (!open) return;
    setAnchor(value);
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    // capture + preventDefault so Escape closes the picker without also closing a surrounding <dialog>
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, value]);

  const m = monthOf(anchor, locale);
  const pick = (d: string) => {
    onChange(d);
    setOpen(false);
  };

  return (
    <div ref={ref} className={clsx("relative", className)}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="input flex items-center gap-2 text-start" aria-haspopup="dialog" aria-expanded={open}>
        <CalendarDays className="size-4 shrink-0 muted" />
        {/* ICU's full fa pattern puts the year first, so compose weekday + "day month year" */}
        <span className="num truncate">
          {fmtDate(`${value}T12:00:00Z`, locale, "UTC", { weekday: "long" })} {fmtDate(`${value}T12:00:00Z`, locale, "UTC", { day: "numeric", month: "long", year: "numeric" })}
        </span>
      </button>
      {open && (
        <div role="dialog" className="absolute start-0 top-full z-50 mt-2 w-72 rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] p-3 shadow-2xl animate-rise">
          <MonthNav label={m.label} onPrev={() => setAnchor(m.prev)} onNext={() => setAnchor(m.next)} />
          <div className="mt-2">
            <MonthGrid anchor={anchor} selected={value} today={today} min={min} max={max} onPick={pick} />
          </div>
          <div className="mt-2 flex justify-between border-t border-[var(--border)] pt-2">
            <button type="button" className="rounded-full px-3 py-1 text-xs strong hover:bg-[var(--surface-sunken)]" onClick={() => pick(today)} disabled={Boolean((min && today < min) || (max && today > max))}>
              {t("a.today")}
            </button>
            <button type="button" className="rounded-full px-3 py-1 text-xs muted hover:bg-[var(--surface-sunken)]" onClick={() => setOpen(false)}>
              {t("a.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
