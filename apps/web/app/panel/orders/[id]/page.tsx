"use client";

import { Check, Copy, Printer } from "lucide-react";
import { use, useState } from "react";
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Spinner, statusTone } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTime, money, num } from "@/lib/format";
import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";
import { useShop } from "@/lib/shop";
import type { OrderDetail } from "@/lib/types";

const FLOW: Record<string, { to: string; label: DictKey }[]> = {
  awaiting_payment: [{ to: "confirmed", label: "a.confirm" }],
  confirmed: [{ to: "processing", label: "a.startProcessing" }],
  processing: [{ to: "ready_to_ship", label: "a.readyToShip" }],
  shipped: [{ to: "delivered", label: "a.deliver" }],
  delivered: [{ to: "completed", label: "a.complete" }],
};

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const { data: o, mutate } = useApi<OrderDetail>(`/shops/${shop.id}/orders/${id}`);
  const [tracking, setTracking] = useState("");
  const [carrier, setCarrier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  if (!o) return <Spinner />;

  const move = async (status: string, extra: Record<string, string> = {}) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/shops/${shop.id}/orders/${o.id}/status`, { method: "POST", json: { status, ...extra } });
      await mutate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const canCancel = !["cancelled", "expired", "returned", "completed", "shipped", "delivered"].includes(o.status);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={`#${o.code}`}
        subtitle={`${t(`ch.${o.channel}` as DictKey)} · ${dateTime(o.createdAt, locale)}`}
        actions={
          <>
            <Button size="sm" onClick={() => (navigator.clipboard.writeText(o.link), setCopied(true))}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? t("a.copied") : t("a.copy")}
            </Button>
            <Button size="sm" onClick={() => (api(`/shops/${shop.id}/orders/${o.id}/printed`, { method: "POST" }), window.print())}>
              <Printer className="size-4" />
            </Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <div className="mb-3 flex flex-wrap gap-2">
              <Badge tone={statusTone(o.status)}>{t(`st.${o.status}` as DictKey)}</Badge>
              <Badge tone={statusTone(o.paymentStatus)}>{t(`pay.${o.paymentStatus}` as DictKey)}</Badge>
              {o.trackingCode && <Badge tone="info">{t("o.tracking")}: {o.trackingCode}</Badge>}
            </div>
            <ul className="divide-y divide-[var(--border)]">
              {o.items.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="strong">
                    {it.title} {it.variantLabel && <span className="muted">· {it.variantLabel}</span>}
                  </span>
                  <span className="num muted">
                    {num(it.quantity, locale)} × {money(it.unitPrice, locale, false)}
                  </span>
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-1.5 border-t border-[var(--border)] pt-3 text-sm">
              <Row k={t("co.subtotal")} v={money(o.subtotal, locale)} />
              {o.discountTotal > 0 && <Row k={t("co.discount")} v={`- ${money(o.discountTotal, locale)}`} />}
              {o.pointsDiscount > 0 && <Row k={t("co.usePoints")} v={`- ${money(o.pointsDiscount, locale)}`} />}
              <Row k={t("co.shippingCost")} v={o.shippingTotal ? money(o.shippingTotal, locale) : t("co.free")} />
              <Row k={t("o.total")} v={money(o.total, locale)} bold />
            </dl>
          </Card>

          {(FLOW[o.status] || o.status === "ready_to_ship" || canCancel) && (
            <Card className="space-y-3">
              {o.status === "ready_to_ship" && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label={t("o.tracking")}>
                    <Input dir="ltr" value={tracking} onChange={(e) => setTracking(e.target.value)} />
                  </Field>
                  <Field label={t("o.carrier")}>
                    <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} />
                  </Field>
                  <div className="flex items-end">
                    <Button variant="primary" className="w-full" loading={busy} onClick={() => move("shipped", { ...(tracking ? { trackingCode: tracking } : {}), ...(carrier ? { carrier } : {}) })}>
                      {t("a.ship")}
                    </Button>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {FLOW[o.status]?.map((f) => (
                  <Button key={f.to} variant="primary" loading={busy} onClick={() => move(f.to)}>
                    {t(f.label)}
                  </Button>
                ))}
                {canCancel && (
                  <Button variant="danger" loading={busy} onClick={() => confirm("?") && move("cancelled")}>
                    {t("a.cancelOrder")}
                  </Button>
                )}
              </div>
              <ErrorNote error={error} />
            </Card>
          )}

          <Card>
            <h3 className="mb-3 font-semibold strong">{t("o.timeline")}</h3>
            <ol className="relative space-y-3 border-s border-[var(--border)] ps-4">
              {o.events.map((e) => (
                <li key={e.id} className="text-sm">
                  <span className="absolute -start-1.5 mt-1.5 size-3 rounded-full border-2 border-[var(--bg)] bg-[var(--accent)]" />
                  <span className="strong">{t((["created", "paid"].includes(e.type) ? `ev.${e.type}` : `st.${e.type}`) as DictKey)}</span>
                  <span className="ms-2 text-xs muted">{dateTime(e.createdAt, locale)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <h3 className="mb-2 font-semibold strong">{t("o.customer")}</h3>
            <p className="strong">{o.customer?.name ?? o.address?.fullName ?? "—"}</p>
            <p className="num text-sm muted" dir="ltr">{o.customer?.phone ?? o.address?.phone}</p>
            {o.customer && (
              <p className="mt-2 text-xs muted">
                {num(o.customer.ordersCount, locale)} {t("c.orders")} · {money(o.customer.totalSpent, locale)} · <Badge tone={statusTone(o.customer.segment)}>{t(`seg.${o.customer.segment}` as DictKey)}</Badge>
              </p>
            )}
          </Card>
          {o.address && (
            <Card>
              <h3 className="mb-2 font-semibold strong">{t("o.address")}</h3>
              <p className="text-sm leading-7">
                {o.address.province}، {o.address.city}
                <br />
                {o.address.line}
                {o.address.postalCode && <span className="num block muted">{o.address.postalCode}</span>}
              </p>
            </Card>
          )}
          {o.payments.length > 0 && (
            <Card>
              <h3 className="mb-2 font-semibold strong">{t("co.payment")}</h3>
              <ul className="space-y-2 text-sm">
                {o.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between">
                    <span>{p.method === "card_to_card" ? t("co.cardToCard") : t("co.gateway")}</span>
                    <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "text-base font-bold strong" : ""}`}>
      <dt className={bold ? "" : "muted"}>{k}</dt>
      <dd className="num">{v}</dd>
    </div>
  );
}
