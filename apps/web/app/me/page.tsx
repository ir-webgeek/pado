"use client";

import clsx from "clsx";
import { CalendarCheck2, LogOut, Package, Wallet } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { addDaysIso, zonedIsoDate } from "@shopino/shared";
import { Logo } from "@/components/logo";
import { LangToggle } from "@/components/prefs";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, Spinner, Tabs, statusTone } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { latinDigits, money, time } from "@/lib/format";
import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";
import type { DaySlots } from "@/lib/types";
import { PLATFORM_ACCENT } from "@/lib/brand";

interface MyAppointment {
  id: string;
  code: string;
  status: string;
  paymentStatus: string;
  refundStatus: string | null;
  startsAt: string;
  price: number;
  paidAmount: number;
  link: string;
  service: { id: string; name: string; durationMin: number };
  staff: { id: string; name: string };
  shop: { name: string; slug: string; timezone: string; brandColor: string };
  canCancel: boolean;
  canReschedule: boolean;
}
interface MyOrder {
  id: string;
  code: string;
  status: string;
  total: number;
  shopName: string;
  link: string;
  trackingCode: string | null;
}

/** Customer portal: phone login, then every booking and order made with that number. */
export default function MyPage() {
  const { t } = useI18n();
  const { data: me, error, mutate } = useApi<{ phone: string; name: string | null }>("/customer/me", { shouldRetryOnError: false });
  return (
    <div data-theme="day" className="min-h-dvh bg-[var(--bg)] text-[var(--text-body)]" style={{ "--accent": PLATFORM_ACCENT } as React.CSSProperties}>
      <header className="border-b border-[var(--border)] bg-[var(--bg-elev)]">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <Link href="/"><Logo label={t("brand.name")} /></Link>
          <div className="flex items-center gap-1">
            <LangToggle />
            {me && (
              <button onClick={async () => (await api("/customer/logout", { method: "POST" }), mutate(undefined, { revalidate: true }))} className="rounded-full p-2 muted" aria-label="logout">
                <LogOut className="size-4" />
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-2xl font-bold strong">{t("me.title")}</h1>
        {!me && !error ? <Spinner className="mt-10" /> : me ? <Portal name={me.name} phone={me.phone} /> : <Login onDone={() => mutate()} />}
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!sent) {
        const r = await api<{ devCode?: string }>("/customer/otp", { method: "POST", json: { phone: latinDigits(phone) } });
        setDevCode(r.devCode ?? null);
        setSent(true);
      } else {
        await api("/customer/verify", { method: "POST", json: { phone: latinDigits(phone), code: latinDigits(code) } });
        onDone();
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={go} className="card mt-6 space-y-4 p-6">
      <p className="text-sm muted">{t("me.sub")}</p>
      <Field label={t("auth.phone")}>
        <Input dir="ltr" inputMode="tel" value={phone} disabled={sent} onChange={(e) => setPhone(e.target.value)} placeholder="0912 000 0000" required />
      </Field>
      {sent && (
        <Field label={t("auth.code")} hint={devCode ? `${t("auth.devCode")}: ${devCode}` : undefined}>
          <Input dir="ltr" inputMode="numeric" maxLength={5} autoFocus className="text-center tracking-[.5em]" value={code} onChange={(e) => setCode(e.target.value)} required />
        </Field>
      )}
      <ErrorNote error={error} />
      <Button variant="primary" size="lg" className="w-full" loading={busy}>
        {sent ? t("auth.verify") : t("auth.sendCode")}
      </Button>
    </form>
  );
}

function Portal({ name, phone }: { name: string | null; phone: string }) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<"upcoming" | "past" | "orders" | "wallet">("upcoming");
  const { data: appts, mutate } = useApi<MyAppointment[]>("/customer/appointments");
  const { data: orders } = useApi<MyOrder[]>(tab === "orders" ? "/customer/orders" : null);
  const { data: me, mutate: reloadMe } = useApi<{ shops: { id: string; name: string; walletBalance: number }[] }>("/customer/me");
  const walletTotal = (me?.shops ?? []).reduce((s, x) => s + x.walletBalance, 0);
  const [moving, setMoving] = useState<MyAppointment | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const now = Date.now();
  const upcoming = (appts ?? []).filter((a) => new Date(a.startsAt).getTime() >= now && !["cancelled", "no_show", "completed"].includes(a.status)).reverse();
  const past = (appts ?? []).filter((a) => !upcoming.includes(a));

  const cancel = async (a: MyAppointment) => {
    if (!confirm(`${t("bk.cancel")}؟`)) return;
    setError(null);
    try {
      const r = await api<{ refund: "wallet" | "requested" | null }>(`/customer/appointments/${a.id}/cancel`, { method: "POST", json: {} });
      if (r.refund === "wallet") setNote(t("w.refunded"));
      else if (r.refund === "requested") setNote(t("me.refundNote"));
      mutate();
      reloadMe();
    } catch (e) {
      setError(e);
    }
  };

  const list = tab === "upcoming" ? upcoming : past;
  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm muted">
        {name ?? ""} <span dir="ltr" className="num">{phone}</span>
      </p>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "upcoming", label: t("me.upcoming"), count: upcoming.length },
          { value: "past", label: t("me.past") },
          { value: "orders", label: t("me.orders") },
          { value: "wallet", label: walletTotal > 0 ? `${t("p.wallet")} · ${money(walletTotal, locale, false)}` : t("p.wallet") },
        ]}
      />
      {note && <p className="rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning">{note}</p>}
      <ErrorNote error={error} />
      {tab === "wallet" ? (
        <MyWallet shops={me?.shops ?? []} />
      ) : tab === "orders" ? (
        !orders ? (
          <Spinner />
        ) : orders.length === 0 ? (
          <Card><Empty icon={<Package className="size-6" />} title={t("me.empty")} /></Card>
        ) : (
          orders.map((o) => (
            <Card key={o.id} className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold strong">{o.shopName}</p>
                <p className="num text-xs muted" dir="ltr">{o.code}</p>
              </div>
              <Badge tone={statusTone(o.status)}>{t(`st.${o.status}` as DictKey)}</Badge>
              <Link href={o.link} className="text-sm text-[var(--accent)]">{t("me.open")}</Link>
            </Card>
          ))
        )
      ) : !appts ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Card><Empty icon={<CalendarCheck2 className="size-6" />} title={t("me.empty")} /></Card>
      ) : (
        list.map((a) => (
          <Card key={a.id} className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs muted">{a.shop.name}</p>
                <p className="font-semibold strong">{a.service.name}</p>
                <p className="num mt-1 text-sm strong">
                  {new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-GB", { timeZone: a.shop.timezone, weekday: "long", day: "numeric", month: "long" }).format(new Date(a.startsAt))} ·{" "}
                  {time(a.startsAt, locale, a.shop.timezone)}
                </p>
                <p className="text-xs muted">{t("bk.with")} {a.staff.name}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge tone={statusTone(a.status)}>{t(`st.${a.status}` as DictKey)}</Badge>
                <Badge tone={statusTone(a.paymentStatus)}>{t(`pay.${a.paymentStatus}` as DictKey)}</Badge>
                {a.refundStatus && <Badge tone="warning">{t("ap.refund")}</Badge>}
              </div>
            </div>
            {a.paidAmount > 0 && <p className="num text-xs muted">{money(a.paidAmount, locale)}</p>}
            <div className="flex flex-wrap gap-2">
              <Link href={a.link}><Button size="sm">{t("me.open")}</Button></Link>
              {a.canReschedule && <Button size="sm" onClick={() => setMoving(a)}>{t("a.reschedule")}</Button>}
              {a.canCancel && <Button size="sm" variant="danger" onClick={() => cancel(a)}>{t("bk.cancel")}</Button>}
              {!a.canCancel && ["pending", "confirmed"].includes(a.status) && <span className="text-xs muted">{t("me.tooLate")}</span>}
            </div>
          </Card>
        ))
      )}
      {moving && <Reschedule appt={moving} onClose={() => setMoving(null)} onDone={() => (setMoving(null), mutate())} />}
    </div>
  );
}

function MyWallet({ shops }: { shops: { id: string; name: string; walletBalance: number }[] }) {
  const { t, locale } = useI18n();
  const { data: history } = useApi<{ id: string; amount: number; reason: string; shopName: string; createdAt: string }[]>("/customer/wallet");
  const funded = shops.filter((s) => s.walletBalance > 0);
  return (
    <div className="space-y-3">
      {funded.length === 0 ? (
        <Card><Empty icon={<Wallet className="size-6" />} title={t("me.empty")} /></Card>
      ) : (
        funded.map((s) => (
          <Card key={s.id} className="flex items-center justify-between">
            <span className="font-semibold strong">{s.name}</span>
            <span className="num font-bold strong">{money(s.walletBalance, locale)}</span>
          </Card>
        ))
      )}
      {history && history.length > 0 && (
        <Card className="space-y-1.5">
          {history.map((h) => (
            <div key={h.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">
                {t(`w.reason.${h.reason}` as DictKey)} · <span className="muted">{h.shopName}</span>
              </span>
              <span className={clsx("num", h.amount > 0 ? "text-success" : "text-danger")} dir="ltr">
                {h.amount > 0 ? "+" : ""}
                {money(h.amount, locale, false)}
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function Reschedule({ appt, onClose, onDone }: { appt: MyAppointment; onClose: () => void; onDone: () => void }) {
  const { t, locale } = useI18n();
  const tz = appt.shop.timezone;
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDaysIso(zonedIsoDate(new Date(), tz), i)), [tz]);
  const [date, setDate] = useState(days[0]!);
  const [anyStaff, setAnyStaff] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { data } = useApi<{ days: DaySlots[] }>(`/customer/appointments/${appt.id}/slots?date=${date}&anyStaff=${anyStaff}`);
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-GB", { timeZone: "UTC", ...o }).format(new Date(`${d}T12:00:00Z`));
  const pick = async (startsAt: string, staffIds: string[]) => {
    setError(null);
    try {
      await api(`/customer/appointments/${appt.id}/reschedule`, { method: "POST", json: { startsAt, ...(anyStaff ? { staffId: staffIds[0] } : {}) } });
      onDone();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Modal open onClose={onClose} title={t("me.pickNew")}>
      <div className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={anyStaff} onChange={(e) => setAnyStaff(e.target.checked)} /> {t("me.anyStaff")}
        </label>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {days.map((d) => (
            <button key={d} onClick={() => setDate(d)} className={clsx("flex w-14 shrink-0 flex-col items-center rounded-2xl border py-2", date === d ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]" : "border-[var(--border)]")}>
              <span className="text-[10px] opacity-80">{fmt(d, { weekday: "short" })}</span>
              <span className="num font-bold">{fmt(d, { day: "numeric" })}</span>
            </button>
          ))}
        </div>
        {!data ? (
          <Spinner />
        ) : !data.days[0]?.slots.length ? (
          <p className="py-6 text-center text-sm muted">{t("ap.noSlots")}</p>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {data.days[0].slots.map((s) => (
              <button key={s.startsAt} onClick={() => pick(s.startsAt, s.staffIds)} className="num rounded-xl border border-[var(--border)] py-2 text-sm strong hover:border-[var(--accent)]">
                {time(s.startsAt, locale, tz)}
              </button>
            ))}
          </div>
        )}
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}
