"use client";

import clsx from "clsx";
import { CalendarCheck2, CheckCircle2, Clock, XCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, use, useState } from "react";
import { Badge, Button, ErrorNote, Spinner, statusTone } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { money, time } from "@/lib/format";
import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";

interface BookingResp {
  booking: { code: string; status: string; paymentStatus: string; startsAt: string; endsAt: string; price: number; discountTotal: number; depositAmount: number; paidAmount: number; holdUntil: string | null };
  service: { name: string; durationMin: number };
  staff: { name: string; title: string };
  customer: { name: string | null; walletBalance: number };
  shop: { name: string; slug: string; brandColor: string; timezone: string };
  policy: { cancelWindowMin: number; refundToWallet: boolean };
  paymentMethods: string[];
}

export default function BookingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  return (
    <Suspense fallback={<Spinner />}>
      <Booking code={code} />
    </Suspense>
  );
}

function Booking({ code }: { code: string }) {
  const { t, locale } = useI18n();
  const sp = useSearchParams();
  const token = sp.get("t") ?? "";
  const { data, mutate } = useApi<BookingResp>(`/public/bookings/${code}?t=${encodeURIComponent(token)}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  if (!data) return <Spinner className="mx-auto mt-20" />;
  const b = data.booking;
  const tz = data.shop.timezone;
  const brand = data.shop.brandColor !== "#d9d0b8" ? data.shop.brandColor : "#1b263b";
  const due = b.depositAmount > 0 && b.paymentStatus !== "paid" && b.status === "pending";
  const canCancel = ["pending", "confirmed"].includes(b.status) && new Date(b.startsAt).getTime() - Date.now() > data.policy.cancelWindowMin * 60_000;
  const paid = sp.get("paid");

  const pay = async (method: "gateway" | "wallet") => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ kind: string; url?: string }>(`/public/bookings/${code}/pay?t=${encodeURIComponent(token)}`, { method: "POST", json: { method } });
      if (r.url) window.location.href = r.url;
      else mutate();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!confirm(t("bk.cancel") + "?")) return;
    setBusy(true);
    try {
      const r = await api<{ refund: "wallet" | "requested" | null }>(`/public/bookings/${code}/cancel?t=${encodeURIComponent(token)}`, { method: "POST", json: {} });
      if (r.refund === "wallet") setNote(t("w.refunded"));
      else if (r.refund === "requested") setNote(t("me.refundNote"));
      mutate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-theme="day" className="min-h-dvh bg-[var(--bg)] px-4 py-10 text-[var(--text-body)]" style={{ "--accent": brand } as React.CSSProperties}>
      <div className="mx-auto max-w-md space-y-4">
        <p className="text-center text-sm muted">{data.shop.name}</p>
        {paid === "1" && <p className="flex items-center gap-2 rounded-xl bg-success/12 px-4 py-3 text-sm text-success"><CheckCircle2 className="size-5" /> {t("co.paid")}</p>}
        {paid === "0" && <p className="flex items-center gap-2 rounded-xl bg-danger/12 px-4 py-3 text-sm text-danger"><XCircle className="size-5" /> {t("co.failed")}</p>}
        <div className="card overflow-hidden p-0">
          <div className={clsx("px-6 py-8 text-center", b.status === "cancelled" ? "bg-danger/10" : "bg-[var(--accent)] text-[var(--accent-ink)]")}>
            {b.status === "cancelled" ? <XCircle className="mx-auto size-10 text-danger" /> : <CalendarCheck2 className="mx-auto size-10" />}
            <p className="mt-3 text-lg font-bold">{b.status === "cancelled" ? t("bk.cancelled") : b.status === "confirmed" ? t("bk.confirmedMsg") : t("bk.pendingMsg")}</p>
            <p className="num mt-1 text-sm opacity-80" dir="ltr">{b.code}</p>
          </div>
          <div className="space-y-3 p-6 text-sm">
            <div className="flex justify-between">
              <span className="muted">{t("ap.service")}</span>
              <span className="font-semibold strong">{data.service.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="muted">{t("ap.time")}</span>
              <span className="num font-semibold strong">
                {new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(b.startsAt))} · {time(b.startsAt, locale, tz)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="muted">{t("ap.staff")}</span>
              <span className="strong">{data.staff.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="muted">{t("sv.price")}</span>
              <span className="num strong">{money(b.price - b.discountTotal, locale)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="muted">{t("co.payment")}</span>
              <Badge tone={statusTone(b.paymentStatus)}>{t(`pay.${b.paymentStatus}` as DictKey)}</Badge>
            </div>
            {due && (
              <div className="rounded-xl bg-warning/10 p-3 text-warning">
                <p className="flex items-center gap-1.5 font-medium"><Clock className="size-4" /> {t("ap.deposit")}: {money(b.depositAmount, locale)}</p>
              </div>
            )}
            {note && <p className="rounded-xl bg-info/10 px-3 py-2 text-info">{note}</p>}
            <ErrorNote error={error} />
            {due && (
              <Button variant="primary" size="lg" className="w-full" loading={busy} onClick={() => pay("gateway")}>
                {t("bk.payDeposit")}
              </Button>
            )}
            {due && data.paymentMethods.includes("wallet") && (
              <Button size="lg" className="w-full" loading={busy} onClick={() => pay("wallet")}>
                {t("w.payWith")} · {money(data.customer.walletBalance, locale)}
              </Button>
            )}
            {canCancel && (
              <Button variant="ghost" className="w-full text-danger" loading={busy} onClick={cancel}>
                {t("bk.cancel")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
