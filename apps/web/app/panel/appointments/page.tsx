"use client";

import clsx from "clsx";
import { CalendarOff, ChevronLeft, ChevronRight, Plus, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { addDaysIso, weekdayOfIso, zonedIsoDate, zonedToUtc } from "@shopino/shared";
import { DatePicker, MonthGrid, MonthNav } from "@/components/date-picker";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, Textarea, Toggle, statusTone } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { monthOf } from "@/lib/calendar";
import { dayLabel, latinDigits, money, num, time, weekdayShort } from "@/lib/format";
import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";
import { useShop } from "@/lib/shop";
import type { Appointment, DaySlots, Service, Staff } from "@/lib/types";

const PX_PER_MIN = 1.1;

function useShopTz() {
  const { shop } = useShop();
  const { data } = useApi<{ shop: { timezone: string } }>(`/shops/${shop.id}`, { revalidateOnFocus: false });
  return data?.shop.timezone ?? "Asia/Tehran";
}

export default function AppointmentsPage() {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const tz = useShopTz();
  const [view, setView] = useState<"day" | "week" | "month">("day");
  const [date, setDate] = useState(() => zonedIsoDate(new Date(), tz));
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [creating, setCreating] = useState<{ staffId?: string; startsAt?: string } | null>(null);
  const [timeOffOpen, setTimeOffOpen] = useState(false);
  const [walkIn, setWalkIn] = useState(false);

  const month = monthOf(date, locale);
  const days = view === "day" ? 1 : view === "week" ? 7 : month.length;
  // week view starts on Saturday (Iranian week)
  const start = view === "day" ? date : view === "week" ? addDaysIso(date, -((weekdayOfIso(date) + 1) % 7)) : month.first;
  const from = zonedToUtc(start, 0, tz).toISOString();
  const to = zonedToUtc(addDaysIso(start, days), 0, tz).toISOString();

  const { data: staff } = useApi<Staff[]>(`/shops/${shop.id}/staff`);
  const { data: services } = useApi<Service[]>(`/shops/${shop.id}/services`);
  const { data: cal, mutate } = useApi<{ appointments: Appointment[]; timeOff: { id: string; staffId: string | null; startsAt: string; endsAt: string; reason: string }[] }>(
    `/shops/${shop.id}/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { refreshInterval: 30_000 },
  );

  const { data: refunds, mutate: reloadRefunds } = useApi<Appointment[]>(`/shops/${shop.id}/appointments/refunds`);
  const activeStaff = (staff ?? []).filter((s) => s.active);
  const shift = (n: number) => (view === "month" ? setDate(n < 0 ? month.prev : month.next) : setDate((d) => addDaysIso(d, n * days)));
  const subtitle = view === "day" ? dayLabel(date, locale) : view === "week" ? `${dayLabel(start, locale)} - ${dayLabel(addDaysIso(start, 6), locale)}` : month.label;

  return (
    <div>
      <PageHeader
        title={t("p.appointments")}
        subtitle={subtitle}
        actions={
          <>
            <Button onClick={() => setWalkIn(true)}>
              <UserPlus className="size-4" /> {t("ap.walkIn")}
            </Button>
            <Button onClick={() => setTimeOffOpen(true)}>
              <CalendarOff className="size-4" /> {t("ap.timeOff")}
            </Button>
            <Button variant="primary" onClick={() => setCreating({})}>
              <Plus className="size-4" /> {t("p.newBooking")}
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="glass flex items-center rounded-full p-1">
          <button className="rounded-full p-2 hover:bg-[var(--surface-sunken)]" onClick={() => shift(-1)} aria-label={t("a.prev")}>
            {locale === "fa" ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          </button>
          <button className="rounded-full px-3 py-1 text-sm strong" onClick={() => setDate(zonedIsoDate(new Date(), tz))}>
            {t("a.today")}
          </button>
          <button className="rounded-full p-2 hover:bg-[var(--surface-sunken)]" onClick={() => shift(1)} aria-label={t("a.next")}>
            {locale === "fa" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        </div>
        <Tabs
          value={view}
          onChange={setView}
          items={[
            { value: "day", label: t("ap.day") },
            { value: "week", label: t("ap.week") },
            { value: "month", label: t("ap.month") },
          ]}
        />
        <DatePicker value={date} onChange={setDate} tz={tz} className="w-60 [&_.input]:!py-1.5 [&_.input]:text-sm" />
      </div>

      {refunds && refunds.length > 0 && (
        <Card className="mb-4 space-y-2 border-warning/40 !p-3">
          <p className="text-sm font-semibold text-warning">
            {t("ap.refund")} ({num(refunds.length, locale)})
          </p>
          {refunds.map((r) => (
            <button key={r.id} onClick={() => setSelected(r)} className="flex w-full items-center justify-between gap-2 rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-start text-sm">
              <span className="strong">{r.customer.name} · {r.service.name}</span>
              <span className="num muted">{money(r.paidAmount, locale)}</span>
            </button>
          ))}
        </Card>
      )}
      {!cal || !staff ? (
        <Spinner />
      ) : view === "day" ? (
        <DayGrid
          date={date}
          tz={tz}
          staff={activeStaff}
          appointments={cal.appointments}
          timeOff={cal.timeOff}
          onSelect={setSelected}
          onEmptyClick={(staffId, startsAt) => setCreating({ staffId, startsAt })}
        />
      ) : view === "week" ? (
        <WeekGrid start={start} tz={tz} appointments={cal.appointments} onSelect={setSelected} />
      ) : (
        <MonthView
          anchor={date}
          tz={tz}
          appointments={cal.appointments}
          onMonth={setDate}
          onPickDay={(d) => {
            setDate(d);
            setView("day");
          }}
        />
      )}

      {selected && (
        <AppointmentModal
          appt={selected}
          tz={tz}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            mutate();
            reloadRefunds();
          }}
        />
      )}
      {creating && services && (
        <BookingModal
          services={services.filter((s) => s.active)}
          staff={activeStaff}
          tz={tz}
          initial={{ date, ...creating }}
          onClose={() => setCreating(null)}
          onBooked={() => {
            setCreating(null);
            mutate();
          }}
        />
      )}
      {walkIn && services && (
        <WalkInModal services={services.filter((s) => s.active)} staff={activeStaff} tz={tz} onClose={() => setWalkIn(false)} onBooked={() => (setWalkIn(false), mutate())} />
      )}
      {timeOffOpen && <TimeOffModal staff={activeStaff} tz={tz} date={date} onClose={() => setTimeOffOpen(false)} onSaved={() => (setTimeOffOpen(false), mutate())} />}
    </div>
  );
}

function DayGrid({
  date,
  tz,
  staff,
  appointments,
  timeOff,
  onSelect,
  onEmptyClick,
}: {
  date: string;
  tz: string;
  staff: Staff[];
  appointments: Appointment[];
  timeOff: { id: string; staffId: string | null; startsAt: string; endsAt: string }[];
  onSelect: (a: Appointment) => void;
  onEmptyClick: (staffId: string, startsAt: string) => void;
}) {
  const { t, locale } = useI18n();
  const weekday = weekdayOfIso(date);
  const dayStart = zonedToUtc(date, 0, tz).getTime();
  const shifts = staff.flatMap((s) => s.workingHours.filter((h) => h.weekday === weekday));
  // half an hour of padding above the earliest shift keeps the first hour label visible
  const startMin = Math.max(0, Math.min(9 * 60, ...shifts.map((h) => Math.floor(h.startMin / 60) * 60)) - 30);
  const endMin = Math.max(18 * 60, ...shifts.map((h) => Math.ceil(h.endMin / 60) * 60));
  const height = (endMin - startMin) * PX_PER_MIN;
  const hours = Array.from({ length: Math.floor((endMin - startMin) / 60) + 1 }, (_, i) => Math.ceil(startMin / 60) * 60 + i * 60).filter((h) => h <= endMin);
  const minOf = (iso: string) => (new Date(iso).getTime() - dayStart) / 60_000;

  if (!staff.length) return <Card><p className="py-10 text-center muted">{t("sv.staff")} —</p></Card>;

  return (
    <Card className="overflow-x-auto !p-0">
      <div className="grid min-w-[640px]" style={{ gridTemplateColumns: `3.5rem repeat(${staff.length}, minmax(9rem, 1fr))` }}>
        <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface-strong)]" />
        {staff.map((s) => (
          <div key={s.id} className="sticky top-0 z-10 flex items-center gap-2 border-b border-s border-[var(--border)] bg-[var(--surface-strong)] px-3 py-2.5">
            <span className="size-2.5 rounded-full" style={{ background: s.color }} />
            <span className="truncate text-sm font-semibold strong">{s.name}</span>
          </div>
        ))}

        <div className="relative" style={{ height }}>
          {hours.map((h) => (
            <span key={h} className="num absolute end-2 -translate-y-1/2 text-[10px] muted" style={{ top: (h - startMin) * PX_PER_MIN }}>
              {String(Math.floor(h / 60)).padStart(2, "0")}:00
            </span>
          ))}
        </div>

        {staff.map((s) => {
          const mine = appointments.filter((a) => a.staffId === s.id && a.status !== "cancelled");
          const off = timeOff.filter((o) => o.staffId === null || o.staffId === s.id);
          const working = s.workingHours.filter((h) => h.weekday === weekday);
          return (
            <div
              key={s.id}
              className="relative border-s border-[var(--border)]"
              style={{ height }}
              onClick={(e) => {
                if (e.target !== e.currentTarget) return;
                const y = e.nativeEvent.offsetY / PX_PER_MIN + startMin;
                const snapped = Math.floor(y / 15) * 15;
                onEmptyClick(s.id, new Date(dayStart + snapped * 60_000).toISOString());
              }}
            >
              {/* closed hours shading */}
              <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--surface-sunken)_6px_12px)]" />
              {working.map((h, i) => (
                <div key={i} className="pointer-events-none absolute inset-x-0 bg-[var(--surface-strong)]" style={{ top: (h.startMin - startMin) * PX_PER_MIN, height: (h.endMin - h.startMin) * PX_PER_MIN }} />
              ))}
              {hours.map((h) => (
                <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-[var(--border)]" style={{ top: (h - startMin) * PX_PER_MIN }} />
              ))}
              {off.map((o) => {
                const top = Math.max(0, minOf(o.startsAt) - startMin);
                const bottom = Math.min(endMin - startMin, minOf(o.endsAt) - startMin);
                if (bottom <= 0 || top >= endMin - startMin) return null;
                return (
                  <div key={o.id} className="pointer-events-none absolute inset-x-1 rounded-lg border border-dashed border-danger/40 bg-danger/10 px-2 py-1 text-[10px] text-danger" style={{ top: top * PX_PER_MIN, height: (bottom - top) * PX_PER_MIN }}>
                    {t("ap.timeOff")}
                  </div>
                );
              })}
              {mine.map((a) => {
                const top = (minOf(a.startsAt) - startMin) * PX_PER_MIN;
                const h = Math.max(22, (minOf(a.endsAt) - minOf(a.startsAt)) * PX_PER_MIN - 2);
                return (
                  <button
                    key={a.id}
                    onClick={() => onSelect(a)}
                    className={clsx(
                      "absolute inset-x-1 overflow-hidden rounded-lg px-2 py-1 text-start text-[11px] leading-4 text-ink-900 shadow-md transition hover:brightness-105",
                      a.status === "pending" && "ring-2 ring-warning ring-offset-1 ring-offset-transparent",
                      (a.status === "completed" || a.status === "no_show") && "opacity-60",
                    )}
                    style={{ top, height: h, background: a.service.color }}
                  >
                    <span className="num font-bold">{time(a.startsAt, locale, tz)}</span> · <span className="font-semibold">{a.customer.name}</span>
                    <span className="block truncate opacity-80">{a.service.name}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function WeekGrid({ start, tz, appointments, onSelect }: { start: string; tz: string; appointments: Appointment[]; onSelect: (a: Appointment) => void }) {
  const { t, locale } = useI18n();
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(start, i));
  const today = zonedIsoDate(new Date(), tz);
  return (
    <div className="grid gap-2 md:grid-cols-7">
      {days.map((d) => {
        const list = appointments.filter((a) => zonedIsoDate(new Date(a.startsAt), tz) === d && a.status !== "cancelled");
        return (
          <Card key={d} className={clsx("min-h-40 !p-2.5", d === today && "border-gold/50")}>
            <p className="mb-2 flex items-baseline justify-between px-1 text-xs">
              <span className="font-semibold strong">{weekdayShort(d, locale)}</span>
              <span className="num muted">{new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${d}T12:00:00Z`))}</span>
            </p>
            <div className="space-y-1.5">
              {list.map((a) => (
                <button key={a.id} onClick={() => onSelect(a)} className="block w-full rounded-lg px-2 py-1.5 text-start text-[11px] text-ink-900" style={{ background: a.service.color }}>
                  <span className="num font-bold">{time(a.startsAt, locale, tz)}</span> {a.customer.name}
                  <span className="block truncate opacity-75">
                    {a.service.name} · {a.staff.name}
                  </span>
                </button>
              ))}
              {!list.length && <p className="py-4 text-center text-[11px] muted">—</p>}
            </div>
            <p className="mt-2 px-1 text-[10px] muted">{num(list.length, locale)} {t("c.visits")}</p>
          </Card>
        );
      })}
    </div>
  );
}

function MonthView({
  anchor,
  tz,
  appointments,
  onMonth,
  onPickDay,
}: {
  anchor: string;
  tz: string;
  appointments: Appointment[];
  onMonth: (iso: string) => void;
  onPickDay: (iso: string) => void;
}) {
  const { locale } = useI18n();
  const m = monthOf(anchor, locale);
  const byDay = useMemo(() => {
    const map = new Map<string, { online: number; offline: number; pending: number }>();
    for (const a of appointments) {
      if (a.status === "cancelled") continue;
      const d = zonedIsoDate(new Date(a.startsAt), tz);
      const v = map.get(d) ?? { online: 0, offline: 0, pending: 0 };
      if (["pos", "phone"].includes(a.channel)) v.offline++;
      else v.online++;
      if (a.status === "pending") v.pending++;
      map.set(d, v);
    }
    return map;
  }, [appointments, tz]);
  return (
    <Card className="mx-auto max-w-3xl">
      <MonthNav label={m.label} onPrev={() => onMonth(m.prev)} onNext={() => onMonth(m.next)} />
      <div className="mt-3">
        <MonthGrid
          anchor={anchor}
          today={zonedIsoDate(new Date(), tz)}
          onPick={onPickDay}
          cellClassName="min-h-16 justify-start gap-1 border border-[var(--border)] py-1.5 sm:min-h-20"
          renderDay={(d) => {
            const v = byDay.get(d);
            if (!v) return null;
            return (
              <span className="flex flex-wrap justify-center gap-0.5 text-[10px] leading-4">
                {v.online > 0 && <span className="rounded-full bg-info/15 px-1.5 text-info">{num(v.online, locale)}</span>}
                {v.offline > 0 && <span className="rounded-full bg-[var(--surface-sunken)] px-1.5 muted">{num(v.offline, locale)}</span>}
                {v.pending > 0 && <span className="size-1.5 self-center rounded-full bg-warning" />}
              </span>
            );
          }}
        />
      </div>
      <MonthLegend />
    </Card>
  );
}

function MonthLegend() {
  const { t } = useI18n();
  return (
    <div className="mt-3 flex flex-wrap gap-3 text-[11px] muted">
      <span className="flex items-center gap-1">
        <span className="size-2 rounded-full bg-info" /> {t("ap.online")}
      </span>
      <span className="flex items-center gap-1">
        <span className="size-2 rounded-full bg-[var(--border-strong)]" /> {t("ap.offline")}
      </span>
      <span className="flex items-center gap-1">
        <span className="size-2 rounded-full bg-warning" /> {t("st.pending")}
      </span>
    </div>
  );
}

const APPT_ACTIONS: Record<string, { to: string; label: DictKey; variant?: "primary" | "danger" }[]> = {
  pending: [
    { to: "confirmed", label: "a.confirm", variant: "primary" },
    { to: "cancelled", label: "a.cancelOrder", variant: "danger" },
  ],
  confirmed: [
    { to: "checked_in", label: "a.checkIn", variant: "primary" },
    { to: "completed", label: "a.complete" },
    { to: "no_show", label: "a.noShow" },
    { to: "cancelled", label: "a.cancelOrder", variant: "danger" },
  ],
  checked_in: [
    { to: "completed", label: "a.complete", variant: "primary" },
    { to: "no_show", label: "a.noShow" },
  ],
};

function AppointmentModal({ appt, tz, onClose, onChanged }: { appt: Appointment; tz: string; onClose: () => void; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState(appt.internalNote ?? "");
  const act = async (to: string) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/shops/${shop.id}/appointments/${appt.id}/status`, { method: "POST", json: { status: to } });
      onChanged();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={appt.service.name}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge tone={statusTone(appt.status)}>{t(`st.${appt.status}` as DictKey)}</Badge>
          <Badge tone={statusTone(appt.paymentStatus)}>{t(`pay.${appt.paymentStatus}` as DictKey)}</Badge>
          <Badge tone={["pos", "phone"].includes(appt.channel) ? "neutral" : "info"}>
            {["pos", "phone"].includes(appt.channel) ? t("ap.offline") : t("ap.online")} · {t(`ch.${appt.channel}` as DictKey)}
          </Badge>
          {appt.refundStatus && <Badge tone={appt.refundStatus === "requested" ? "warning" : "neutral"}>{t("ap.refund")}: {appt.refundStatus}</Badge>}
          <Badge tone={statusTone(appt.customer.segment)}>{t(`seg.${appt.customer.segment}` as DictKey)}</Badge>
          {appt.customer.noShowCount > 0 && <Badge tone="danger">{num(appt.customer.noShowCount, locale)} {t("c.noShows")}</Badge>}
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs muted">{t("ap.time")}</dt>
            <dd className="num strong">
              {dayLabel(zonedIsoDate(new Date(appt.startsAt), tz), locale)} · {time(appt.startsAt, locale, tz)}–{time(appt.endsAt, locale, tz)}
            </dd>
          </div>
          <div>
            <dt className="text-xs muted">{t("ap.staff")}</dt>
            <dd className="strong">{appt.staff.name}</dd>
          </div>
          <div>
            <dt className="text-xs muted">{t("o.customer")}</dt>
            <dd className="strong">{appt.customer.name}</dd>
            <dd className="num text-xs muted" dir="ltr">{appt.customer.phone}</dd>
          </div>
          <div>
            <dt className="text-xs muted">{t("sv.price")}</dt>
            <dd className="num strong">{money(appt.price, locale)}</dd>
            {appt.depositAmount > 0 && (
              <dd className="text-xs muted">
                {t("ap.deposit")}: {money(appt.depositAmount, locale)}
              </dd>
            )}
          </div>
        </dl>
        {appt.note && <p className="rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-sm">{appt.note}</p>}
        <Field label={t("ap.note")}>
          <Textarea
            className="min-h-16"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== (appt.internalNote ?? "") && api(`/shops/${shop.id}/appointments/${appt.id}/notes`, { method: "PATCH", json: { internalNote: note } })}
          />
        </Field>
        <ErrorNote error={error} />
        {appt.refundStatus === "requested" && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-warning/10 p-3 text-sm">
            <span className="flex-1 text-warning">
              {t("ap.refund")} · {money(appt.paidAmount, locale)}
            </span>
            {(["wallet", "refunded", "kept"] as const).map((st) => (
              <Button
                key={st}
                size="sm"
                variant={st === "wallet" ? "primary" : "secondary"}
                onClick={async () => {
                  try {
                    await api(`/shops/${shop.id}/appointments/${appt.id}/refund`, { method: "POST", json: { status: st } });
                    onChanged();
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                {t(st === "wallet" ? "w.toWallet" : st === "refunded" ? "ap.refunded" : "ap.kept")}
              </Button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {(APPT_ACTIONS[appt.status] ?? []).map((a) => (
            <Button key={a.to} variant={a.variant ?? "secondary"} loading={busy} onClick={() => act(a.to)}>
              {t(a.label)}
            </Button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function BookingModal({
  services,
  staff,
  tz,
  initial,
  onClose,
  onBooked,
}: {
  services: Service[];
  staff: Staff[];
  tz: string;
  initial: { date: string; staffId?: string; startsAt?: string };
  onClose: () => void;
  onBooked: () => void;
}) {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const initialStaffServices = initial.staffId ? services.filter((s) => s.staffIds.includes(initial.staffId!)) : services;
  const [serviceId, setServiceId] = useState(initialStaffServices[0]?.id ?? services[0]?.id ?? "");
  const [staffId, setStaffId] = useState(initial.staffId ?? "");
  const [date, setDate] = useState(initial.startsAt ? zonedIsoDate(new Date(initial.startsAt), tz) : initial.date);
  const [slot, setSlot] = useState<string | null>(initial.startsAt ?? null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const service = services.find((s) => s.id === serviceId);
  const eligible = useMemo(() => staff.filter((s) => service?.staffIds.includes(s.id)), [staff, service]);

  const { data: slots } = useApi<{ days: DaySlots[] }>(
    serviceId ? `/shops/${shop.id}/slots?serviceId=${serviceId}&date=${date}&days=1${staffId ? `&staffId=${staffId}` : ""}` : null,
  );
  const list = slots?.days[0]?.slots ?? [];

  async function book() {
    if (!slot) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/shops/${shop.id}/appointments`, {
        method: "POST",
        json: { serviceId, staffId: staffId || undefined, startsAt: slot, customer: { name, phone: latinDigits(phone) }, note: note || undefined, channel: "phone" },
      });
      onBooked();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t("p.newBooking")} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("ap.service")}>
            <Select value={serviceId} onChange={(e) => (setServiceId(e.target.value), setSlot(null))}>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {num(s.durationMin, locale)} {t("ap.minutes")}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("ap.staff")}>
            <Select value={staffId} onChange={(e) => (setStaffId(e.target.value), setSlot(null))}>
              <option value="">{t("ap.anyStaff")}</option>
              {eligible.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("ap.day")}>
            <DatePicker value={date} tz={tz} onChange={(d) => (setDate(d), setSlot(null))} />
          </Field>
        </div>
        <div>
          <p className="label">{t("ap.pickSlot")}</p>
          {!slots ? (
            <Spinner />
          ) : list.length === 0 ? (
            <p className="rounded-xl bg-[var(--surface-sunken)] px-3 py-4 text-center text-sm muted">{t("ap.noSlots")}</p>
          ) : (
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
              {list.map((s) => (
                <button
                  key={s.startsAt}
                  onClick={() => setSlot(s.startsAt)}
                  className={clsx("num rounded-lg border px-1 py-1.5 text-sm transition", slot === s.startsAt ? "border-gold bg-[var(--accent)] font-semibold text-[var(--accent-ink)]" : "border-[var(--border)] hover:border-gold/50")}
                >
                  {time(s.startsAt, locale, tz)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("ap.customerName")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t("ap.customerPhone")}>
            <Input dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <Field label={t("ap.note")}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("a.cancel")}</Button>
          <Button variant="primary" loading={busy} disabled={!slot || name.length < 2 || phone.length < 10} onClick={book}>
            {t("bk.confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function TimeOffModal({ staff, tz, date, onClose, onSaved }: { staff: Staff[]; tz: string; date: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { shop } = useShop();
  const [staffId, setStaffId] = useState("");
  const [day, setDay] = useState(date);
  const [fromT, setFromT] = useState("00:00");
  const [toT, setToT] = useState("23:59");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<unknown>(null);
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  async function save() {
    try {
      await api(`/shops/${shop.id}/time-off`, {
        method: "POST",
        json: { staffId: staffId || null, startsAt: zonedToUtc(day, toMin(fromT), tz).toISOString(), endsAt: zonedToUtc(day, toMin(toT), tz).toISOString(), reason },
      });
      onSaved();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <Modal open onClose={onClose} title={t("ap.timeOff")}>
      <div className="space-y-3">
        <Field label={t("ap.staff")}>
          <Select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            <option value="">{t("o.all")}</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("ap.day")}>
          <DatePicker value={day} tz={tz} onChange={setDay} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="⟶">
            <Input type="time" value={fromT} onChange={(e) => setFromT(e.target.value)} />
          </Field>
          <Field label="⟵">
            <Input type="time" value={toT} onChange={(e) => setToT(e.target.value)} />
          </Field>
        </div>
        <Field label={t("ap.note")}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("a.cancel")}</Button>
          <Button variant="primary" onClick={save}>{t("a.save")}</Button>
        </div>
      </div>
    </Modal>
  );
}

function WalkInModal({ services, staff, tz, onClose, onBooked }: { services: Service[]; staff: Staff[]; tz: string; onClose: () => void; onBooked: () => void }) {
  const { t } = useI18n();
  const { shop } = useShop();
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const service = services.find((s) => s.id === serviceId);
  const eligible = staff.filter((s) => service?.staffIds.includes(s.id));
  const [staffId, setStaffId] = useState(eligible[0]?.id ?? "");
  const [now, setNow] = useState(true);
  const [day, setDay] = useState(zonedIsoDate(new Date(), tz));
  const [at, setAt] = useState("12:00");
  const [outsideHours, setOutsideHours] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const startsAt = now ? undefined : zonedToUtc(day, Number(at.slice(0, 2)) * 60 + Number(at.slice(3, 5)), tz).toISOString();
      await api(`/shops/${shop.id}/appointments/walk-in`, {
        method: "POST",
        json: { serviceId, staffId: staffId || eligible[0]?.id, startsAt, outsideHours, customer: { name, phone: latinDigits(phone) } },
      });
      onBooked();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={t("ap.walkIn")}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("ap.service")}>
            <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("ap.staff")}>
            <Select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              {eligible.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Toggle checked={now} onChange={setNow} label={t("ap.now")} />
        {!now && (
          <div className="grid grid-cols-2 gap-3">
            <DatePicker value={day} tz={tz} onChange={setDay} />
            <Input type="time" value={at} onChange={(e) => setAt(e.target.value)} />
          </div>
        )}
        <Toggle checked={outsideHours} onChange={setOutsideHours} label={t("ap.outsideHours")} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("ap.customerName")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t("ap.customerPhone")}>
            <Input dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("a.cancel")}</Button>
          <Button variant="primary" loading={busy} disabled={name.length < 2 || phone.length < 10 || !serviceId} onClick={save}>
            {t("a.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
