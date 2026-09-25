"use client";

import clsx from "clsx";
import { Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PLANS, PLAN_IDS, type PlanFeature } from "@shopino/shared";
import { useI18n } from "@/lib/locale-client";

const featureLabels: Partial<Record<PlanFeature, { fa: string; en: string }>> = {
  appointments: { fa: "نوبت‌دهی آنلاین و تقویم پرسنل", en: "Online booking & staff calendar" },
  appointment_reminders: { fa: "یادآوری پیامکی نوبت", en: "SMS booking reminders" },
  agent: { fa: "ایجنت فروش و رزرو در دایرکت", en: "Sales & booking agent in DMs" },
  agent_training: { fa: "آموزش ایجنت با دانش شما", en: "Train the agent on your knowledge" },
  auto_print: { fa: "چاپ خودکار فاکتور و برچسب", en: "Auto-print invoice & label" },
  appointment_deposits: { fa: "بیعانه آنلاین نوبت", en: "Online booking deposits" },
  agent_voice: { fa: "درک پیام صوتی", en: "Understands voice notes" },
  card_sms_match: { fa: "تایید خودکار کارت‌به‌کارت", en: "Auto-match card transfers" },
  custom_domain: { fa: "دامنه اختصاصی", en: "Custom domain" },
  multi_staff: { fa: "چند پرسنل و شیفت", en: "Multi-staff & shifts" },
  seo_tools: { fa: "ابزار سئو", en: "SEO tools" },
  pos: { fa: "صندوق فروش حضوری", en: "In-store POS" },
  seo_ai: { fa: "سئوی هوشمند", en: "AI SEO" },
  priority_support: { fa: "پشتیبانی اولویت‌دار", en: "Priority support" },
};

const names = {
  starter: { fa: "استارتر", en: "Starter" },
  lite: { fa: "لایت", en: "Lite" },
  pro: { fa: "پرو", en: "Pro" },
  promax: { fa: "پرو مکس", en: "Pro Max" },
  luxury: { fa: "لاکچری", en: "Luxury" },
};

export function PricingCards() {
  const { t, locale } = useI18n();
  const [yearly, setYearly] = useState(false);
  const fmt = (n: number) => new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US").format(n);
  const lim = (v: number | null) => (v === null ? t("pricing.unlimited") : fmt(v));

  return (
    <div>
      <div className="mb-8 flex justify-center">
        <div className="glass inline-flex rounded-full p-1">
          {[false, true].map((y) => (
            <button
              key={String(y)}
              onClick={() => setYearly(y)}
              className={clsx("rounded-full px-5 py-2 text-sm transition", yearly === y ? "bg-[var(--accent)] font-medium text-[var(--accent-ink)]" : "muted")}
            >
              {y ? t("pricing.yearly") : t("pricing.monthly")}
              {y && <span className="ms-2 rounded-full bg-success/15 px-2 py-0.5 text-[11px] text-success">{t("pricing.yearlySave")}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {PLAN_IDS.map((id) => {
          const p = PLANS[id];
          const price = yearly ? p.yearlyPerMonth : p.monthly;
          const prev = id === "starter" ? [] : PLANS[PLAN_IDS[PLAN_IDS.indexOf(id) - 1]!].features;
          const extra = p.features.filter((f) => !prev.includes(f) && featureLabels[f]);
          return (
            <div key={id} className={clsx("card relative flex flex-col p-5", p.recommended && "border-gold/50 shadow-[0_0_0_1px_rgb(217_208_184/.3),0_24px_60px_-24px_rgb(217_208_184/.35)]")}>
              {p.recommended && <span className="absolute -top-3 start-5 rounded-full bg-[var(--accent)] px-3 py-0.5 text-xs font-medium text-[var(--accent-ink)]">{t("pricing.recommended")}</span>}
              <h3 className="text-lg font-bold strong">{names[id][locale]}</h3>
              <div className="mt-3 min-h-16">
                {price === null ? (
                  <p className="text-2xl font-bold strong">{t("pricing.custom")}</p>
                ) : (
                  <p>
                    <span className="num text-3xl font-extrabold strong">{fmt(price / 1000)}</span>
                    <span className="ms-1 text-sm muted">{locale === "fa" ? "هزار تومان" : "K Toman"}</span>
                    <span className="block text-xs muted">{t("pricing.perMonth")}</span>
                  </p>
                )}
              </div>
              <Link
                href={id === "luxury" ? "/login?plan=luxury" : `/login?plan=${id}`}
                className={clsx(
                  "mt-4 inline-flex h-10 items-center justify-center rounded-full text-sm font-medium",
                  p.recommended ? "bg-[var(--accent)] text-[var(--accent-ink)]" : "border border-[var(--border-strong)] strong hover:bg-[var(--surface-sunken)]",
                )}
              >
                {id === "luxury" ? t("pricing.contact") : t("cta.start")}
              </Link>
              <ul className="mt-5 space-y-2 text-sm">
                {p.aiGiftCredit > 0 && (
                  <li className="rounded-xl bg-gold/10 px-3 py-2 text-xs text-[var(--accent)]">
                    {fmt(p.aiGiftCredit)} {t("pricing.toman")} {t("pricing.aiGift")}
                  </li>
                )}
                <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" /> {lim(p.limits.products)} {t("pricing.products")}</li>
                <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" /> {lim(p.limits.ordersPerMonth)} {t("pricing.orders")}</li>
                <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" /> {lim(p.limits.staff)} {t("pricing.staff")} · {lim(p.limits.bookingsPerMonth)} {t("pricing.bookings")}</li>
                {extra.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" /> {featureLabels[f]![locale]}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
