"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { date as fmtDate, money, num } from "@/lib/format";
import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";
import type { OrderDetail } from "@/lib/types";

export interface Seller {
  name: string;
  logo: string | null;
  timezone: string;
  invoice: { address: string; phone: string; postalCode: string; footer: string };
}

export type PrintKind = "invoice" | "label";

/** Mounts the document into <body>, opens the print dialog, then unmounts. */
export function OrderPrint({ kind, order, seller, onDone }: { kind: PrintKind; order: OrderDetail; seller: Seller; onDone: () => void }) {
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      window.print();
      onDone();
    });
    return () => cancelAnimationFrame(id);
  }, [onDone]);
  return createPortal(
    <div className="print-root" data-theme="day">
      <style>{`@page { size: ${kind === "label" ? "100mm 150mm" : "A5"}; margin: ${kind === "label" ? "4mm" : "8mm"}; }`}</style>
      {kind === "invoice" ? <Invoice order={order} seller={seller} /> : <Label order={order} seller={seller} />}
    </div>,
    document.body,
  );
}

function Invoice({ order: o, seller }: { order: OrderDetail; seller: Seller }) {
  const { t, locale } = useI18n();
  const paid = o.paymentStatus === "paid";
  return (
    <article className="space-y-4 text-[11px] leading-5">
      <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-3">
        <div className="flex items-center gap-3">
          {seller.logo && <img src={seller.logo} alt="" className="size-12 object-contain" />}
          <div>
            <p className="text-base font-bold">{seller.name}</p>
            <p>{t("inv.title")}</p>
          </div>
        </div>
        <dl className="text-end">
          <div>
            <dt className="inline">{t("inv.number")}: </dt>
            <dd className="num inline font-bold" dir="ltr">{o.code}</dd>
          </div>
          <div>
            <dt className="inline">{t("inv.date")}: </dt>
            <dd className="num inline">{fmtDate(o.paidAt ?? o.createdAt, locale, seller.timezone)}</dd>
          </div>
        </dl>
      </header>

      <section className="grid grid-cols-2 gap-3">
        <Party title={t("inv.seller")} lines={[seller.name, seller.invoice.address, seller.invoice.postalCode && `${t("co.postal")}: ${seller.invoice.postalCode}`, seller.invoice.phone]} />
        <Party
          title={t("inv.buyer")}
          lines={[
            o.address?.fullName ?? o.customer?.name ?? "",
            o.address ? `${o.address.province}، ${o.address.city}، ${o.address.line}` : "",
            o.address?.postalCode && `${t("co.postal")}: ${o.address.postalCode}`,
            o.address?.phone ?? o.customer?.phone ?? "",
          ]}
        />
      </section>

      <table className="w-full border-collapse text-center">
        <thead>
          <tr className="bg-black/10">
            {(["inv.row", "inv.item", "inv.qty", "inv.unit", "inv.lineTotal"] as DictKey[]).map((k) => (
              <th key={k} className="border border-black/60 px-1.5 py-1 font-semibold">{t(k)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {o.items.map((it, i) => (
            <tr key={it.id}>
              <td className="num border border-black/60 px-1.5 py-1">{num(i + 1, locale)}</td>
              <td className="border border-black/60 px-1.5 py-1 text-start">
                {it.title}
                {it.variantLabel && <span> · {it.variantLabel}</span>}
              </td>
              <td className="num border border-black/60 px-1.5 py-1">{num(it.quantity, locale)}</td>
              <td className="num border border-black/60 px-1.5 py-1">{money(it.unitPrice, locale, false)}</td>
              <td className="num border border-black/60 px-1.5 py-1">{money(it.total, locale, false)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ms-auto w-1/2 space-y-1">
        <Sum k={t("co.subtotal")} v={money(o.subtotal, locale)} />
        {o.discountTotal > 0 && <Sum k={t("co.discount")} v={`- ${money(o.discountTotal, locale)}`} />}
        {o.pointsDiscount > 0 && <Sum k={t("co.usePoints")} v={`- ${money(o.pointsDiscount, locale)}`} />}
        <Sum k={t("co.shippingCost")} v={o.shippingTotal ? money(o.shippingTotal, locale) : t("co.free")} />
        <Sum k={t("o.total")} v={money(o.total, locale)} bold />
      </dl>

      <p>
        {t("co.payment")}: {paid && o.paymentMethod ? `${t(`pm.${o.paymentMethod}` as DictKey)} · ` : ""}
        {t(`pay.${o.paymentStatus}` as DictKey)}
      </p>
      {seller.invoice.footer && <p className="border-t border-black/40 pt-2 text-center">{seller.invoice.footer}</p>}
    </article>
  );
}

function Party({ title, lines }: { title: string; lines: (string | false | null | undefined)[] }) {
  return (
    <div className="rounded border border-black/60 p-2">
      <p className="mb-1 font-bold">{title}</p>
      {lines.filter(Boolean).map((l, i) => (
        <p key={i}>{l}</p>
      ))}
    </div>
  );
}

function Sum({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "border-t border-black pt-1 text-sm font-bold" : ""}`}>
      <dt>{k}</dt>
      <dd className="num">{v}</dd>
    </div>
  );
}

function Label({ order: o, seller }: { order: OrderDetail; seller: Seller }) {
  const { t, locale } = useI18n();
  const count = o.items.reduce((s, it) => s + it.quantity, 0);
  return (
    <article className="flex h-[142mm] flex-col gap-2 text-[12px] leading-6">
      <section className="flex-1 rounded border-2 border-black p-3">
        <p className="text-[11px] font-bold">{t("inv.to")}</p>
        <p className="text-lg font-bold">{o.address?.fullName ?? o.customer?.name}</p>
        <p className="num text-base" dir="ltr">{o.address?.phone ?? o.customer?.phone}</p>
        {o.address && (
          <p className="mt-1 text-sm">
            {o.address.province}، {o.address.city}
            <br />
            {o.address.line}
          </p>
        )}
        {o.address?.postalCode && (
          <p className="mt-2">
            {t("co.postal")}: <span className="num text-xl font-bold tracking-[.2em]" dir="ltr">{o.address.postalCode}</span>
          </p>
        )}
      </section>
      <section className="rounded border border-black p-2 text-[11px]">
        <p className="font-bold">{t("inv.from")}: {seller.name}</p>
        {seller.invoice.address && <p>{seller.invoice.address}</p>}
        <p className="num" dir="ltr">
          {[seller.invoice.phone, seller.invoice.postalCode].filter(Boolean).join(" · ")}
        </p>
      </section>
      <section className="flex items-end justify-between rounded border border-black p-2">
        <div className="text-[11px]">
          <p>
            {t("inv.items")}: <span className="num">{num(count, locale)}</span>
          </p>
          {o.trackingCode && (
            <p className="whitespace-nowrap">
              {t("o.tracking")}: <bdi className="num">{o.trackingCode}</bdi>
            </p>
          )}
        </div>
        <p className="num whitespace-nowrap font-mono text-xl font-bold" dir="ltr">
          {o.code}
        </p>
      </section>
    </article>
  );
}
