"use client";

import clsx from "clsx";
import { ArrowLeft, ArrowRight, Check, Clock, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { use, useMemo, useState } from "react";
import { addDaysIso, zonedIsoDate } from "@shopino/shared";
import { Avatar, Button, ErrorNote, Field, Input, Spinner } from "@/components/ui";
import { LangToggle } from "@/components/prefs";
import { api, useApi } from "@/lib/api";
import { latinDigits, money, num, time } from "@/lib/format";
import { useI18n } from "@/lib/locale-client";
import type { DaySlots } from "@/lib/types";

interface ShopResp {
  shop: { name: string; brandColor: string; timezone: string; kind: string };
}
interface ServicesResp {
  services: { id: string; name: string; description: string; durationMin: number; price: number; priceFrom: boolean; deposit: { type: string; value: number }; capacity: number; color: string; staffIds: string[] }[];
  staff: { id: string; name: string; title: string; color: string }[];
}

export default function BookingWizard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { t, locale } = useI18n();
  const router = useRouter();
  const { data: shop } = useApi<ShopResp>(`/public/shops/${slug}`);
  const { data } = useApi<ServicesResp>(`/public/shops/${slug}/services`);
  const tz = shop?.shop.timezone ?? "Asia/Tehran";
  const [step, setStep] = useState(0);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<string>("");
  const [date, setDate] = useState(() => zonedIsoDate(new Date(), "Asia/Tehran"));
  const [slot, setSlot] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const service = data?.services.find((s) => s.id === serviceId);
  const staffForService = useMemo(() => data?.staff.filter((s) => service?.staffIds.includes(s.id)) ?? [], [data, service]);
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDaysIso(zonedIsoDate(new Date(), tz), i)), [tz]);
  const { data: slots } = useApi<{ days: DaySlots[] }>(serviceId && step === 1 ? `/public/shops/${slug}/slots?serviceId=${serviceId}&date=${date}&days=1${staffId ? `&staffId=${staffId}` : ""}` : null);
  const brand = shop?.shop.brandColor && shop.shop.brandColor !== "#d9d0b8" ? shop.shop.brandColor : "#1b263b";
  const Back = locale === "fa" ? ArrowRight : ArrowLeft;

  async function book() {
    if (!serviceId || !slot) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ code: string; token: string; depositAmount: number }>(`/public/shops/${slug}/bookings`, {
        method: "POST",
        json: { serviceId, staffId: staffId || undefined, startsAt: slot, customer: { name, phone: latinDigits(phone) }, note: note || undefined },
      });
      router.push(`/b/booking/${r.code}?t=${r.token}${r.depositAmount ? "&pay=1" : ""}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  const dayFmt = (d: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-GB", { timeZone: "UTC", ...opts }).format(new Date(`${d}T12:00:00Z`));

  return (
    <div data-theme="day" className="min-h-dvh bg-[var(--bg)] text-[var(--text-body)]" style={{ "--accent": brand } as React.CSSProperties}>
      <header className="border-b border-[var(--border)] bg-[var(--bg-elev)]">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <span className="font-bold strong">{shop?.shop.name}</span>
          <LangToggle />
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="text-2xl font-bold strong">{t("bk.title")}</h1>
        <ol className="my-5 flex gap-2">
          {[t("bk.step1"), t("bk.step2"), t("bk.step3")].map((s, i) => (
            <li key={s} className={clsx("flex flex-1 items-center gap-2 rounded-full px-3 py-1.5 text-xs", i === step ? "bg-[var(--accent)] text-[var(--accent-ink)]" : i < step ? "bg-[var(--accent-soft)] strong" : "bg-[var(--surface-sunken)] muted")}>
              <span className="num flex size-5 items-center justify-center rounded-full bg-black/10">{i < step ? <Check className="size-3" /> : num(i + 1, locale)}</span>
              {s}
            </li>
          ))}
        </ol>

        {!data ? (
          <Spinner />
        ) : step === 0 ? (
          <div className="space-y-2">
            {data.services.map((s) => (
              <button
                key={s.id}
                onClick={() => (setServiceId(s.id), setStaffId(""), setSlot(null), setStep(1))}
                className="card flex w-full items-center gap-4 p-4 text-start transition hover:border-[var(--accent)]"
              >
                <span className="h-12 w-1.5 rounded-full" style={{ background: s.color }} />
                <span className="flex-1">
                  <span className="block font-semibold strong">{s.name}</span>
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
              <div className="flex gap-2 overflow-x-auto pb-1">
                {[{ id: "", name: t("ap.anyStaff"), color: "#aebbd0", title: "" }, ...staffForService].map((s) => (
                  <button
                    key={s.id || "any"}
                    onClick={() => (setStaffId(s.id), setSlot(null))}
                    className={clsx("flex shrink-0 items-center gap-2 rounded-full border py-1 pe-3 ps-1 text-sm", staffId === s.id ? "border-[var(--accent)] strong" : "border-[var(--border)] muted")}
                  >
                    <Avatar name={s.name} color={s.color} size={28} /> {s.name}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2 overflow-x-auto pb-1">
              {days.map((d) => (
                <button
                  key={d}
                  onClick={() => (setDate(d), setSlot(null))}
                  className={clsx("flex w-16 shrink-0 flex-col items-center rounded-2xl border py-2", date === d ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]" : "border-[var(--border)]")}
                >
                  <span className="text-[11px] opacity-80">{dayFmt(d, { weekday: "short" })}</span>
                  <span className="num text-lg font-bold">{dayFmt(d, { day: "numeric" })}</span>
                  <span className="text-[10px] opacity-70">{dayFmt(d, { month: "short" })}</span>
                </button>
              ))}
            </div>
            {!slots ? (
              <Spinner />
            ) : (slots.days[0]?.slots.length ?? 0) === 0 ? (
              <p className="rounded-2xl bg-[var(--surface-sunken)] py-10 text-center text-sm muted">{t("ap.noSlots")}</p>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {slots.days[0]!.slots.map((s) => (
                  <button
                    key={s.startsAt}
                    onClick={() => (setSlot(s.startsAt), setStep(2))}
                    className="num rounded-xl border border-[var(--border)] py-2.5 text-sm font-medium strong transition hover:border-[var(--accent)]"
                  >
                    {time(s.startsAt, locale, tz)}
                    {s.seatsLeft !== undefined && <span className="block text-[10px] font-normal muted">{num(s.seatsLeft, locale)} ✦</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <button className="flex items-center gap-1 text-sm muted" onClick={() => setStep(1)}>
              <Back className="size-4" /> {service?.name} · {slot && `${dayFmt(date, { weekday: "long", day: "numeric", month: "long" })} ${time(slot, locale, tz)}`}
            </button>
            <div className="card space-y-3 p-5">
              <Field label={t("co.fullName")}>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label={t("auth.phone")}>
                <Input dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
              <Field label={t("ap.note")}>
                <Input value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              {service && service.deposit.type !== "none" && (
                <p className="rounded-xl bg-[var(--accent-soft)] px-3 py-2 text-sm strong">
                  {t("ap.deposit")}: {service.deposit.type === "percent" ? `${num(service.deposit.value, locale)}٪` : money(service.deposit.value, locale)}
                </p>
              )}
              <ErrorNote error={error} />
              <Button variant="primary" size="lg" className="w-full" loading={busy} disabled={name.length < 2 || phone.length < 10} onClick={book}>
                {t("bk.confirm")}
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
