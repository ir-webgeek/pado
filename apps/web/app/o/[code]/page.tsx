"use client";

import clsx from "clsx";
import { CheckCircle2, Clock, CreditCard, Landmark, PackageCheck, Truck, Upload, Wallet, XCircle } from "lucide-react";
import { use, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Button, ErrorNote, Field, Input, Spinner } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTime, latinDigits, money, num } from "@/lib/format";
import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";
import { PLATFORM_ACCENT, shopAccent } from "@/lib/brand";

interface OrderResp {
  order: {
    code: string;
    status: string;
    paymentStatus: string;
    subtotal: number;
    discountTotal: number;
    shippingTotal: number;
    pointsDiscount: number;
    total: number;
    trackingCode: string | null;
    carrier: string | null;
    reservedUntil: string | null;
    address: { fullName: string; phone: string; province: string; city: string; line: string; postalCode?: string } | null;
    items: { id: string; title: string; variantLabel: string; quantity: number; total: number }[];
    timeline: { type: string; at: string }[];
  };
  customer: { name: string | null; points: number; walletBalance: number } | null;
  shop: { name: string; slug: string; brandColor: string };
  shippingMethods: { id: string; name: string; price: number; freeOver: number | null }[];
  paymentMethods: ("gateway" | "card_to_card" | "wallet")[];
  loyalty: { pointValue: number } | null;
  pendingCardPayment: { id: string; status: string; card: { cardNumber: string; holder: string; bank: string } } | null;
}

type Start = { kind: "redirect"; url: string } | { kind: "card_to_card"; paymentId: string; amount: number; card: { cardNumber: string; holder: string; bank: string } } | { kind: "paid" };

export default function OrderLinkPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  return (
    <Suspense fallback={<Spinner />}>
      <OrderLink code={code} />
    </Suspense>
  );
}

const STEPS = ["confirmed", "processing", "shipped", "delivered"] as const;

function OrderLink({ code }: { code: string }) {
  const { t, locale } = useI18n();
  const sp = useSearchParams();
  const token = sp.get("t") ?? "";
  const paidFlag = sp.get("paid");
  const { data, error, mutate } = useApi<OrderResp>(`/public/orders/${code}?t=${encodeURIComponent(token)}`, { refreshInterval: 20_000 });

  if (error) return <Shell brand={PLATFORM_ACCENT}><p className="py-20 text-center muted">{t("common.error")}</p></Shell>;
  if (!data) return <Shell brand={PLATFORM_ACCENT}><Spinner className="mx-auto my-20" /></Shell>;
  const o = data.order;
  const awaiting = o.status === "awaiting_payment" && o.paymentStatus !== "pending_review";
  const stepIdx = STEPS.indexOf(o.status === "ready_to_ship" ? "processing" : o.status === "completed" ? "delivered" : (o.status as (typeof STEPS)[number]));

  return (
    <Shell brand={data.shop.brandColor}>
      <p className="text-sm muted">{data.shop.name}</p>
      <h1 className="num mt-1 text-xl font-bold strong" dir="ltr">
        #{o.code}
      </h1>

      {paidFlag === "1" && <Banner ok text={t("co.paid")} />}
      {paidFlag === "0" && <Banner text={t("co.failed")} />}

      {!awaiting && o.status !== "cancelled" && o.status !== "expired" && (
        <div className="card mt-5 p-5">
          <div className="flex items-center justify-between">
            {STEPS.map((s, i) => {
              const Icon = [CheckCircle2, PackageCheck, Truck, CheckCircle2][i]!;
              const done = stepIdx >= i;
              return (
                <div key={s} className="flex flex-1 flex-col items-center gap-1.5 text-center">
                  <span className={clsx("flex size-10 items-center justify-center rounded-full", done ? "bg-[var(--accent)] text-[var(--accent-ink)]" : "bg-[var(--surface-sunken)] muted")}>
                    <Icon className="size-5" />
                  </span>
                  <span className={clsx("text-[11px]", done ? "strong" : "muted")}>{t(`st.${s}` as DictKey)}</span>
                </div>
              );
            })}
          </div>
          {o.paymentStatus === "pending_review" && <p className="mt-4 rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning">{t("co.receiptSent")}</p>}
          {o.trackingCode && (
            <p className="mt-4 rounded-xl bg-[var(--surface-sunken)] px-3 py-2 text-sm">
              {t("o.tracking")}: <b className="num strong" dir="ltr">{o.trackingCode}</b> {o.carrier && <span className="muted">· {o.carrier}</span>}
            </p>
          )}
        </div>
      )}
      {(o.status === "cancelled" || o.status === "expired") && <Banner text={t(`st.${o.status}` as DictKey)} />}

      <div className="card mt-5 p-5">
        <ul className="divide-y divide-[var(--border)] text-sm">
          {o.items.map((it) => (
            <li key={it.id} className="flex justify-between gap-3 py-2">
              <span className="strong">
                {it.title} {it.variantLabel && <span className="muted">· {it.variantLabel}</span>} <span className="num muted">×{num(it.quantity, locale)}</span>
              </span>
              <span className="num">{money(it.total, locale)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 space-y-1 border-t border-[var(--border)] pt-3 text-sm">
          {o.discountTotal > 0 && <Line k={t("co.discount")} v={`- ${money(o.discountTotal, locale)}`} />}
          {o.pointsDiscount > 0 && <Line k={t("co.usePoints")} v={`- ${money(o.pointsDiscount, locale)}`} />}
          {!awaiting && <Line k={t("co.shippingCost")} v={o.shippingTotal ? money(o.shippingTotal, locale) : t("co.free")} />}
          <Line k={t("o.total")} v={money(awaiting ? o.subtotal - o.discountTotal : o.total, locale)} bold />
        </div>
        {awaiting && o.reservedUntil && (
          <p className="mt-3 flex items-center gap-1.5 text-xs muted">
            <Clock className="size-3.5" /> {t("co.reserved")} {dateTime(o.reservedUntil, locale)}
          </p>
        )}
      </div>

      {awaiting && (data.pendingCardPayment ? <CardToCard code={code} token={token} paymentId={data.pendingCardPayment.id} amount={o.total} card={data.pendingCardPayment.card} onDone={() => mutate()} /> : <Checkout code={code} token={token} data={data} onDone={() => mutate()} />)}
    </Shell>
  );
}

function Checkout({ code, token, data, onDone }: { code: string; token: string; data: OrderResp; onDone: () => void }) {
  const { t, locale } = useI18n();
  const [addr, setAddr] = useState({ fullName: data.customer?.name ?? "", phone: "", province: "", city: "", line: "", postalCode: "" });
  const [shipping, setShipping] = useState(data.shippingMethods[0]?.id ?? "");
  const [method, setMethod] = useState<OrderResp["paymentMethods"][number]>("gateway");
  const [usePoints, setUsePoints] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [card, setCard] = useState<Extract<Start, { kind: "card_to_card" }> | null>(null);
  const set = (k: keyof typeof addr) => (e: React.ChangeEvent<HTMLInputElement>) => setAddr({ ...addr, [k]: e.target.value });

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<Start>(`/public/orders/${code}/complete?t=${encodeURIComponent(token)}`, {
        method: "POST",
        json: {
          address: { ...addr, phone: latinDigits(addr.phone), postalCode: addr.postalCode ? latinDigits(addr.postalCode) : undefined },
          paymentMethod: method,
          shippingMethodId: shipping || undefined,
          usePoints: usePoints ? data.customer?.points ?? 0 : 0,
        },
      });
      if (r.kind === "redirect") window.location.href = r.url;
      else if (r.kind === "card_to_card") setCard(r);
      else onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (card) return <CardToCard code={code} token={token} paymentId={card.paymentId} amount={card.amount} card={card.card} onDone={onDone} />;

  return (
    <form onSubmit={pay} className="card mt-5 space-y-4 p-5">
      <h2 className="font-semibold strong">{t("co.address")}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("co.fullName")}>
          <Input required value={addr.fullName} onChange={set("fullName")} />
        </Field>
        <Field label={t("auth.phone")}>
          <Input required dir="ltr" inputMode="tel" value={addr.phone} onChange={set("phone")} />
        </Field>
        <Field label={t("co.province")}>
          <Input required value={addr.province} onChange={set("province")} />
        </Field>
        <Field label={t("co.city")}>
          <Input required value={addr.city} onChange={set("city")} />
        </Field>
        <Field label={t("co.line")} className="sm:col-span-2">
          <Input required minLength={5} value={addr.line} onChange={set("line")} />
        </Field>
        <Field label={t("co.postal")}>
          <Input dir="ltr" inputMode="numeric" value={addr.postalCode} onChange={set("postalCode")} />
        </Field>
      </div>

      {data.shippingMethods.length > 0 && (
        <div>
          <p className="label">{t("co.shipping")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.shippingMethods.map((m) => (
              <label key={m.id} className={clsx("flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2.5 text-sm", shipping === m.id ? "border-[var(--accent)]" : "border-[var(--border)]")}>
                <span className="flex items-center gap-2">
                  <input type="radio" name="ship" checked={shipping === m.id} onChange={() => setShipping(m.id)} className="accent-[var(--accent)]" />
                  <span className="strong">{m.name}</span>
                </span>
                <span className="num muted">{m.price ? money(m.price, locale) : t("co.free")}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="label">{t("co.payment")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {data.paymentMethods.map((m) => (
            <button type="button" key={m} onClick={() => setMethod(m)} className={clsx("flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm", method === m ? "border-[var(--accent)] strong" : "border-[var(--border)] muted")}>
              {m === "gateway" ? <CreditCard className="size-4" /> : m === "wallet" ? <Wallet className="size-4" /> : <Landmark className="size-4" />}
              {m === "gateway" ? t("co.gateway") : m === "wallet" ? `${t("w.payWith")} · ${money(data.customer?.walletBalance ?? 0, locale)}` : t("co.cardToCard")}
            </button>
          ))}
        </div>
      </div>

      {data.loyalty && (data.customer?.points ?? 0) > 0 && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={usePoints} onChange={(e) => setUsePoints(e.target.checked)} className="accent-[var(--accent)]" />
          {t("co.usePoints")}: {num(data.customer!.points, locale)} ({money(data.customer!.points * data.loyalty.pointValue, locale)})
        </label>
      )}
      <ErrorNote error={error} />
      <Button variant="primary" size="lg" className="w-full" loading={busy}>
        {t("co.pay")}
      </Button>
    </form>
  );
}

function CardToCard({ code, token, paymentId, amount, card, onDone }: { code: string; token: string; paymentId: string; amount: number; card: { cardNumber: string; holder: string; bank: string }; onDone: () => void }) {
  const { t, locale } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api(`/public/payments/${paymentId}/receipt?code=${encodeURIComponent(code)}&t=${encodeURIComponent(token)}`, { method: "POST", body: fd });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  return (
    <div className="card mt-5 space-y-4 p-5">
      <p className="text-sm muted">{t("co.transferTo")}</p>
      <div className="rounded-2xl bg-gradient-to-br from-[#1a1631] to-[#5b4fa8] p-5 text-white">
        <p className="text-xs opacity-70">{card.bank}</p>
        <p className="num mt-4 text-xl tracking-widest" dir="ltr">
          {card.cardNumber.replace(/(\d{4})(?=\d)/g, "$1 ")}
        </p>
        <p className="mt-3 text-sm">{card.holder}</p>
      </div>
      <p className="num text-lg font-bold strong">{money(amount, locale)}</p>
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-strong)] px-3 py-6 text-sm muted">
        <Upload className="size-4" /> {file ? file.name : t("co.uploadReceipt")}
        <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <ErrorNote error={error} />
      <Button variant="primary" size="lg" className="w-full" disabled={!file} loading={busy} onClick={upload}>
        {t("a.send")}
      </Button>
    </div>
  );
}

function Shell({ brand, children }: { brand: string; children: React.ReactNode }) {
  return (
    <div data-theme="day" className="min-h-dvh bg-[var(--bg)] px-4 py-8 text-[var(--text-body)]" style={{ "--accent": shopAccent(brand) } as React.CSSProperties}>
      <div className="mx-auto max-w-xl">{children}</div>
    </div>
  );
}

function Banner({ ok, text }: { ok?: boolean; text: string }) {
  return (
    <div className={clsx("mt-4 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium", ok ? "bg-success/12 text-success" : "bg-danger/12 text-danger")}>
      {ok ? <CheckCircle2 className="size-5" /> : <XCircle className="size-5" />} {text}
    </div>
  );
}

function Line({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className={clsx("flex justify-between", bold && "text-base font-bold strong")}>
      <span className={bold ? "" : "muted"}>{k}</span>
      <span className="num">{v}</span>
    </div>
  );
}
