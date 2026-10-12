"use client";

import { Printer } from "lucide-react";
import { dateTime, money, num } from "@/lib/format";
import { useI18n } from "@/lib/locale-client";

export interface ReceiptData {
  shopName: string;
  code: string;
  paidAt?: string;
  items: { id: string; title: string; variantLabel: string; quantity: number; total: number }[];
  discountTotal: number;
  pointsDiscount: number;
  shippingTotal: number;
  total: number;
  customer?: string | null;
}

/**
 * Thank-you moment after payment: a small printer prints the receipt line by line. The paper is a real
 * receipt (print button prints only it); motion is skipped for people who prefer reduced motion.
 */
export function ReceiptPrinter({ data }: { data: ReceiptData }) {
  const { t, locale } = useI18n();
  const lines = [
    ...(data.discountTotal > 0 ? [[t("co.discount"), `- ${money(data.discountTotal, locale)}`]] : []),
    ...(data.pointsDiscount > 0 ? [[t("co.usePoints"), `- ${money(data.pointsDiscount, locale)}`]] : []),
    [t("co.shippingCost"), data.shippingTotal ? money(data.shippingTotal, locale) : t("co.free")],
  ];
  return (
    <div className="receipt-stage mt-5">
      {/* printer body */}
      <div className="relative z-10 mx-auto w-72 rounded-[1.4rem] bg-gradient-to-b from-[#3b3a4a] to-[#25242f] px-5 pb-3 pt-4 shadow-xl print:hidden">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs font-medium text-white/80">
            <Printer className="size-4" /> {data.shopName}
          </span>
          <span className="receipt-led size-2 rounded-full bg-emerald-400" aria-hidden />
        </div>
        <div className="mt-3 h-2 rounded-full bg-black/60 shadow-[inset_0_2px_4px_rgba(0,0,0,.6)]" aria-hidden />
      </div>
      {/* paper coming out of the slot */}
      <div className="relative mx-auto -mt-2 w-64 overflow-hidden print:mt-0 print:w-full print:overflow-visible">
        <article className="receipt-paper relative bg-white px-5 pb-8 pt-6 font-[inherit] text-[13px] leading-6 text-neutral-800 shadow-lg" aria-label={t("rc.title")}>
          <p className="text-center text-base font-bold">{data.shopName}</p>
          <p className="text-center text-[11px] text-neutral-500">{t("rc.title")}</p>
          <p className="num mt-2 text-center font-mono text-sm" dir="ltr">
            #{data.code}
          </p>
          {data.paidAt && <p className="num text-center text-[11px] text-neutral-500">{dateTime(data.paidAt, locale)}</p>}
          <hr className="my-3 border-dashed border-neutral-300" />
          <ul className="space-y-1">
            {data.items.map((it) => (
              <li key={it.id} className="flex justify-between gap-3">
                <span>
                  {it.title}
                  {it.variantLabel && <span className="text-neutral-500"> · {it.variantLabel}</span>} <span className="num text-neutral-500">×{num(it.quantity, locale)}</span>
                </span>
                <span className="num shrink-0">{money(it.total, locale)}</span>
              </li>
            ))}
          </ul>
          <hr className="my-3 border-dashed border-neutral-300" />
          {lines.map(([k, v]) => (
            <p key={k} className="flex justify-between text-neutral-600">
              <span>{k}</span>
              <span className="num">{v}</span>
            </p>
          ))}
          <p className="mt-1 flex justify-between text-base font-bold">
            <span>{t("o.total")}</span>
            <span className="num">{money(data.total, locale)}</span>
          </p>
          <hr className="my-3 border-dashed border-neutral-300" />
          <p className="text-center font-semibold">{data.customer ? t("rc.thanksName").replace("{name}", data.customer) : t("rc.thanks")}</p>
          <p className="mt-1 text-center text-[11px] text-neutral-500">{t("rc.track")}</p>
          <div className="receipt-zigzag absolute inset-x-0 bottom-0 h-3" aria-hidden />
        </article>
      </div>
      <div className="mt-3 flex justify-center print:hidden">
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-4 py-2 text-sm strong hover:bg-[var(--surface-sunken)]">
          <Printer className="size-4" /> {t("rc.print")}
        </button>
      </div>
    </div>
  );
}
