"use client";

import clsx from "clsx";
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Moon, Sun, Sunrise, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Assistant } from "@/components/store/assistant";
import { use, useEffect, useMemo, useRef, useState } from "react";
import { addDaysIso, normalizeIranPhone, percentOf, zonedIsoDate } from "@shopino/shared";
import { Avatar, Button, ErrorNote, Field, Input, Modal, Spinner } from "@/components/ui";
import { ShamsiCalendar } from "@/components/farsi/calendar";
import { LangToggle } from "@/components/prefs";
import { api, useApi } from "@/lib/api";
import { latinDigits, money, num, time } from "@/lib/format";
import { useI18n } from "@/lib/locale-client";
import { ServiceShowcase } from "@/components/service-media";
import type { BeforeAfter, DaySlots } from "@/lib/types";
import { shopAccent } from "@/lib/brand";
import { getDmRef } from "@/components/dm-ref";

interface ShopResp {
  shop: { name: string; brandColor: string; timezone: string; kind: string; assistant: boolean };
}
interface ServicesResp {
  services: {
    id: string;
    name: string;
    description: string;
    durationMin: number;
    price: number;
    priceFrom: boolean;
    deposit: { type: string; value: number };
    capacity: number;
    color: string;
    image: string | null;
    banner: string | null;
    gallery: string[];
    beforeAfter: BeforeAfter[];
    staffIds: string[];
  }[];
  staff: { id: string; name: string; title: string; color: string; avatar: string | null }[];
}

const WINDOW = 14;
const CONTACT_KEY = "booking-contact";
type Part = "morning" | "afternoon" | "evening";
const PART_ICON = { morning: Sunrise, afternoon: Sun, evening: Moon } as const;

export default function BookingWizard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { t, locale } = useI18n();
  const router = useRouter();
  const { data: shop } = useApi<ShopResp>(`/public/shops/${slug}`);
  const { data } = useApi<ServicesResp>(`/public/shops/${slug}/services`);
  const tz = shop?.shop.timezone ?? "Asia/Tehran";
  const today = zonedIsoDate(new Date(), tz);
  const [step, setStep] = useState(0);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<string>("");
  const [windowStart, setWindowStart] = useState(today);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const top = useRef<HTMLDivElement>(null);

  // returning customers do not retype their contact details (this browser only)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CONTACT_KEY) ?? "null") as { name?: string; phone?: string } | null;
      if (saved?.name) setName(saved.name);
      if (saved?.phone) setPhone(saved.phone);
    } catch {
      // storage unavailable: start empty
    }
  }, []);
  useEffect(() => top.current?.scrollIntoView({ block: "start", behavior: "smooth" }), [step]);

  const service = data?.services.find((s) => s.id === serviceId);
  const staffForService = useMemo(() => data?.staff.filter((s) => service?.staffIds.includes(s.id)) ?? [], [data, service]);
  const days = useMemo(() => Array.from({ length: WINDOW }, (_, i) => addDaysIso(windowStart, i)), [windowStart]);
  // two weeks of free times in one call: the strip shows which days still have room
  const { data: slots, isLoading } = useApi<{ days: DaySlots[] }>(
    serviceId && step >= 1 ? `/public/shops/${slug}/slots?serviceId=${serviceId}&date=${windowStart}&days=${WINDOW}${staffId ? `&staffId=${staffId}` : ""}` : null,
    { keepPreviousData: false },
  );
  const byDay = useMemo(() => new Map((slots?.days ?? []).map((d) => [d.date, d.slots])), [slots]);
  const firstFree = days.find((d) => (byDay.get(d)?.length ?? 0) > 0) ?? null;
  // land on the first day that has room unless the customer picked one
  useEffect(() => {
    if (!slots) return;
    if (!date || !days.includes(date)) setDate(firstFree ?? days[0]!);
  }, [slots, date, days, firstFree]);

  const brand = shopAccent(shop?.shop.brandColor);
  const Back = locale === "fa" ? ArrowRight : ArrowLeft;
  const Prev = locale === "fa" ? ChevronRight : ChevronLeft;
  const Next = locale === "fa" ? ChevronLeft : ChevronRight;
  const phoneOk = normalizeIranPhone(phone) !== null;
  // same rule as the server (fixed capped at the price, percent capped at 100)
  const depositAmount = !service
    ? 0
    : service.deposit.type === "percent"
      ? percentOf(service.price, Math.min(service.deposit.value, 100))
      : service.deposit.type === "fixed"
        ? Math.min(service.deposit.value, service.price)
        : 0;
  const staffName = staffId ? staffForService.find((s) => s.id === staffId)?.name : null;

  async function book() {
    if (!serviceId || !slot) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ code: string; token: string; depositAmount: number }>(`/public/shops/${slug}/bookings`, {
        method: "POST",
        json: { serviceId, staffId: staffId || undefined, startsAt: slot, customer: { name, phone: latinDigits(phone) }, note: note || undefined, ref: getDmRef() },
      });
      try {
        localStorage.setItem(CONTACT_KEY, JSON.stringify({ name, phone }));
      } catch {
        // not remembered; booking still done
      }
      router.push(`/b/booking/${r.code}?t=${r.token}${r.depositAmount ? "&pay=1" : ""}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  const dayFmt = (d: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-GB", { timeZone: "UTC", ...opts }).format(new Date(`${d}T12:00:00Z`));
  const hourOf = (iso: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));
  const partOf = (iso: string): Part => (hourOf(iso) < 12 ? "morning" : hourOf(iso) < 17 ? "afternoon" : "evening");
  const daySlots = (date && byDay.get(date)) || [];
  const parts = (["morning", "afternoon", "evening"] as Part[]).map((p) => ({ part: p, slots: daySlots.filter((s) => partOf(s.startsAt) === p) })).filter((g) => g.slots.length);
  const whenLabel = slot && date ? `${dayFmt(date, { weekday: "long", day: "numeric", month: "long" })}${locale === "fa" ? "،" : ","} ${t("bk.at")} ${time(slot, locale, tz)}` : "";
  const pickService = (id: string) => (setServiceId(id), setStaffId(""), setSlot(null), setDate(null), setWindowStart(today), setStep(1));
  const moveWindow = (start: string) => (setWindowStart(start < today ? today : start), setDate(null), setSlot(null));

  return (
    <div data-theme="day" className="min-h-dvh bg-[var(--bg)] text-[var(--text-body)]" style={{ "--accent": brand } as React.CSSProperties}>
      <header className="border-b border-[var(--border)] bg-[var(--bg-elev)]">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <span className="font-bold strong">{shop?.shop.name}</span>
          <span className="flex items-center gap-1">
            <Link href="/me" className="rounded-full px-3 py-2 text-xs muted">{t("p.myBookings")}</Link>
            <LangToggle />
          </span>
        </div>
      </header>
      <main ref={top} className={clsx("mx-auto max-w-2xl scroll-mt-4 px-4 py-6", step === 1 && slot && "pb-32")}>
        <h1 className="text-2xl font-bold strong">{t("bk.title")}</h1>
        <ol className="my-5 flex gap-2">
          {[t("bk.step1"), t("bk.step2"), t("bk.step3")].map((s, i) => (
            <li key={s} className="flex-1">
              <button
                type="button"
                disabled={i >= step}
                onClick={() => setStep(i)}
                aria-current={i === step ? "step" : undefined}
                className={clsx(
                  "flex w-full items-center gap-2 rounded-full px-3 py-1.5 text-xs disabled:cursor-default",
                  i === step ? "bg-[var(--accent)] text-[var(--accent-ink)]" : i < step ? "bg-[var(--accent-soft)] strong" : "bg-[var(--surface-sunken)] muted",
                )}
              >
                <span className="num flex size-5 items-center justify-center rounded-full bg-black/10">{i < step ? <Check className="size-3" /> : num(i + 1, locale)}</span>
                {s}
              </button>
            </li>
          ))}
        </ol>

        {!data ? (
          <Spinner />
        ) : step === 0 ? (
          <div className="space-y-2">
            {data.services.map((s) => (
              <button key={s.id} onClick={() => pickService(s.id)} className="card flex w-full items-center gap-4 p-4 text-start transition hover:border-[var(--accent)]">
                {s.image ? <Avatar src={s.image} name={s.name} size={52} /> : <span className="h-12 w-1.5 rounded-full" style={{ background: s.color }} />}
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold strong">{s.name}</span>
                  {s.description && <span className="mt-0.5 line-clamp-2 block text-xs muted">{s.description}</span>}
                  <span className="mt-1 flex flex-wrap gap-3 text-xs muted">
                    <span className="inline-flex items-center gap-1"><Clock className="size-3" /> {num(s.durationMin, locale)} {t("ap.minutes")}</span>
                    {s.capacity > 1 && <span className="inline-flex items-center gap-1"><Users className="size-3" /> {num(s.capacity, locale)}</span>}
                    {s.deposit.type !== "none" && <span>{t("ap.deposit")}</span>}
                  </span>
                </span>
                <span className="num text-sm font-semibold strong">
                  {s.priceFrom && <span className="text-xs font-normal muted">{t("sv.priceFrom")} </span>}
                  {money(s.price, locale)}
                </span>
              </button>
            ))}
          </div>
        ) : step === 1 ? (
          <div className="space-y-5">
            <button className="flex items-center gap-1 text-sm muted" onClick={() => setStep(0)}>
              <Back className="size-4" /> {service?.name}
            </button>
            {staffForService.length > 1 && (
              <div>
                <p className="mb-2 text-sm font-medium strong">{t("bk.who")}</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {[{ id: "", name: t("ap.anyStaff"), color: "#aebbd0", title: "", avatar: null }, ...staffForService].map((s) => (
                    <button
                      key={s.id || "any"}
                      onClick={() => (setStaffId(s.id), setSlot(null), setDate(null))}
                      aria-pressed={staffId === s.id}
                      className={clsx("flex shrink-0 items-center gap-2 rounded-full border py-1 pe-3 ps-1 text-sm", staffId === s.id ? "border-[var(--accent)] bg-[var(--accent-soft)] strong" : "border-[var(--border)] muted")}
                    >
                      <Avatar name={s.name} color={s.color} src={s.avatar} size={28} /> {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium strong">{t("bk.when")}</p>
                <span className="flex items-center gap-1">
                  <button
                    onClick={() => moveWindow(addDaysIso(windowStart, -WINDOW))}
                    disabled={windowStart <= today}
                    className="rounded-full p-1.5 hover:bg-[var(--surface-sunken)] disabled:opacity-30"
                    aria-label={t("bk.prevWeeks")}
                  >
                    <Prev className="size-4" />
                  </button>
                  <button onClick={() => moveWindow(addDaysIso(windowStart, WINDOW))} className="rounded-full p-1.5 hover:bg-[var(--surface-sunken)]" aria-label={t("bk.nextWeeks")}>
                    <Next className="size-4" />
                  </button>
                  <button onClick={() => setCalendarOpen(true)} className="flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-1 text-xs strong hover:border-[var(--accent)]">
                    <CalendarDays className="size-3.5" /> {t("bk.calendar")}
                  </button>
                </span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1" role="listbox" aria-label={t("bk.when")}>
                {days.map((d) => {
                  const n = byDay.get(d)?.length ?? 0;
                  const full = slots && n === 0;
                  return (
                    <button
                      key={d}
                      role="option"
                      aria-selected={date === d}
                      onClick={() => (setDate(d), setSlot(null))}
                      className={clsx(
                        "flex w-16 shrink-0 flex-col items-center rounded-2xl border py-2 transition",
                        date === d ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]" : full ? "border-dashed border-[var(--border)] opacity-45" : "border-[var(--border)] hover:border-[var(--accent)]",
                      )}
                    >
                      <span className="text-[11px] opacity-80">{d === today ? t("bk.today") : dayFmt(d, { weekday: "short" })}</span>
                      <span className="num text-lg font-bold">{dayFmt(d, { day: "numeric" })}</span>
                      <span className="num text-[10px] opacity-75">{!slots ? dayFmt(d, { month: "short" }) : full ? t("bk.full") : t("bk.free").replace("{n}", num(n, locale))}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {isLoading || !slots ? (
              <Spinner />
            ) : !firstFree ? (
              <div className="rounded-2xl bg-[var(--surface-sunken)] px-4 py-8 text-center text-sm">
                <p className="muted">{t("bk.noneInWindow")}</p>
                <Button size="sm" className="mt-3" onClick={() => moveWindow(addDaysIso(windowStart, WINDOW))}>
                  {t("bk.nextWeeks")}
                </Button>
              </div>
            ) : daySlots.length === 0 ? (
              <div className="rounded-2xl bg-[var(--surface-sunken)] px-4 py-8 text-center text-sm">
                <p className="muted">{t("ap.noSlots")}</p>
                <button className="mt-2 text-[var(--accent)] underline-offset-2 hover:underline" onClick={() => (setDate(firstFree), setSlot(null))}>
                  {t("bk.firstFree").replace("{d}", dayFmt(firstFree, { weekday: "long", day: "numeric", month: "long" }))}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {parts.map((g) => {
                  const Icon = PART_ICON[g.part];
                  return (
                    <div key={g.part}>
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium muted">
                        <Icon className="size-3.5" /> {t(`bk.${g.part}`)}
                      </p>
                      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                        {g.slots.map((s) => (
                          <button
                            key={s.startsAt}
                            onClick={() => setSlot(s.startsAt)}
                            aria-pressed={slot === s.startsAt}
                            className={clsx(
                              "num rounded-xl border py-2.5 text-sm font-medium transition",
                              slot === s.startsAt ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]" : "border-[var(--border)] strong hover:border-[var(--accent)]",
                            )}
                          >
                            {time(s.startsAt, locale, tz)}
                            {s.seatsLeft !== undefined && <span className="block text-[10px] font-normal opacity-75">{t("bk.seats").replace("{n}", num(s.seatsLeft, locale))}</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {service && (service.banner || service.gallery.length > 0 || service.beforeAfter.length > 0 || service.description) && (
              <details className="card group p-0">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium strong">
                  {t("bk.about")}
                  <ChevronLeft className="size-4 transition group-open:-rotate-90 ltr:rotate-180" />
                </summary>
                <div className="border-t border-[var(--border)] p-3">
                  {service.description && <p className="mb-3 text-sm leading-7 muted">{service.description}</p>}
                  <ServiceShowcase service={service} />
                </div>
              </details>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="card p-4">
              <p className="mb-2 text-xs muted">{t("bk.summary")}</p>
              <div className="flex items-start gap-3">
                <span className="mt-1 h-10 w-1.5 shrink-0 rounded-full" style={{ background: service?.color }} />
                <div className="min-w-0 flex-1 space-y-0.5 text-sm">
                  <p className="font-semibold strong">{service?.name}</p>
                  <p className="num strong">{whenLabel}</p>
                  <p className="muted">
                    {num(service?.durationMin ?? 0, locale)} {t("ap.minutes")}
                    {staffName && ` · ${t("bk.with")} ${staffName}`}
                  </p>
                </div>
                <button className="shrink-0 text-xs text-[var(--accent)]" onClick={() => setStep(1)}>
                  {t("bk.change")}
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-3 text-sm">
                <span className="muted">{t("o.total")}</span>
                <span className="num font-semibold strong">
                  {service?.priceFrom && <span className="text-xs font-normal muted">{t("sv.priceFrom")} </span>}
                  {money(service?.price ?? 0, locale)}
                </span>
              </div>
              {depositAmount > 0 && (
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="muted">{t("bk.depositNow")}</span>
                  <span className="num font-semibold text-[var(--accent)]">{money(depositAmount, locale)}</span>
                </div>
              )}
            </div>
            <form
              className="card space-y-3 p-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim().length >= 2 && phoneOk) void book();
              }}
            >
              <Field label={t("co.fullName")}>
                <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} />
              </Field>
              <Field label={t("auth.phone")} hint={phone && !phoneOk ? t("bk.phoneInvalid") : undefined}>
                <Input dir="ltr" inputMode="tel" autoComplete="tel" placeholder="0912 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={Boolean(phone) && !phoneOk} required />
              </Field>
              <Field label={t("ap.note")}>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("bk.notePh")} />
              </Field>
              <ErrorNote error={error} />
              <Button variant="primary" size="lg" className="w-full" loading={busy} disabled={name.trim().length < 2 || !phoneOk}>
                {depositAmount > 0 ? t("bk.confirmPay") : t("bk.confirm")}
              </Button>
            </form>
          </div>
        )}
      </main>

      {/* chosen time stays in view with one clear next step */}
      {step === 1 && slot && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[var(--bg-elev)]/95 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold strong">{service?.name}</p>
              <p className="num truncate text-xs muted">{whenLabel}</p>
            </div>
            <Button variant="primary" onClick={() => setStep(2)}>
              {t("bk.continue")}
            </Button>
          </div>
        </div>
      )}

      <Modal open={calendarOpen} onClose={() => setCalendarOpen(false)} title={t("bk.pickDate")}>
        <ShamsiCalendar
          locale={locale}
          today={today}
          min={today}
          selected={date ?? undefined}
          onPick={(d) => {
            setCalendarOpen(false);
            setWindowStart(d);
            setDate(d);
            setSlot(null);
          }}
        />
      </Modal>
      {shop?.shop.assistant && <Assistant slug={slug} serviceId={serviceId ?? undefined} mode="booking" raised={step === 1 && Boolean(slot)} />}
    </div>
  );
}
