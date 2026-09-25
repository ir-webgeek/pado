"use client";

import clsx from "clsx";
import { Check, CreditCard, Link2, MessageCircle, PackageCheck, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/locale-client";

const script = {
  fa: [
    { from: "c", text: "سلام! کت کتان کرم سایز ۳۸ دارید؟" },
    { from: "a", text: "سلام 🌿 بله موجوده، ۴٫۸ میلیون تومان. برات ثبتش کنم؟" },
    { from: "c", text: "آره یکی لطفاً 🙏" },
    { from: "a", text: "ثبت شد ✅ تا ۲ ساعت برات رزروه. آدرس و پرداخت توی این لینک:", link: "SHP-7K3M9QW2XZ · ۴٫۸ میلیون" },
    { from: "c", text: "پرداخت کردم ✅" },
    { from: "a", text: "دریافت شد 🎉 فردا ارسال می‌شه و کد رهگیری همین‌جا میاد." },
  ],
  en: [
    { from: "c", text: "Hi! Is the cream linen coat in size 38 available?" },
    { from: "a", text: "Hi 🌿 Yes, in stock - 4.8M Toman. Shall I place it for you?" },
    { from: "c", text: "Yes please 🙏" },
    { from: "a", text: "Done ✅ Reserved for 2 hours. Address and payment are in this link:", link: "SHP-7K3M9QW2XZ · 4.8M" },
    { from: "c", text: "Paid ✅" },
    { from: "a", text: "Received 🎉 Ships tomorrow, tracking code lands right here." },
  ],
} as const;

const steps = [
  { icon: MessageCircle, k: 1 },
  { icon: Search, k: 2 },
  { icon: Link2, k: 3 },
  { icon: CreditCard, k: 4 },
  { icon: PackageCheck, k: 5 },
] as const;

export function AgentFlow() {
  const { t, locale } = useI18n();
  const lines = script[locale];
  const [shown, setShown] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setShown((s) => (s >= lines.length + 2 ? 1 : s + 1)), 1600);
    return () => clearInterval(id);
  }, [lines.length]);
  const step = Math.min(4, Math.max(0, Math.ceil(shown / 1.4) - 1));

  return (
    <div className="grid items-center gap-8 lg:grid-cols-2">
      <ol className="space-y-2">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const active = i === step;
          return (
            <li
              key={s.k}
              className={clsx("flex gap-4 rounded-2xl border p-4 transition-all duration-500", active ? "border-gold/40 bg-gold/10" : "border-transparent opacity-60")}
            >
              <span className={clsx("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl", active ? "bg-[var(--accent)] text-[var(--accent-ink)]" : "bg-[var(--surface-sunken)]")}>
                <Icon className="size-4" />
              </span>
              <div>
                <p className="font-semibold strong">{t(`flow.${s.k}.t` as "flow.1.t")}</p>
                <p className="mt-0.5 text-sm muted">{t(`flow.${s.k}.s` as "flow.1.s")}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="glass mx-auto w-full max-w-sm rounded-[2rem] p-3">
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-2 pb-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-pink-400 to-amber-300 text-xs font-bold text-ink-900">M</span>
          <div className="text-xs">
            <p className="font-semibold strong">{locale === "fa" ? "مریم" : "Maryam"}</p>
            <p className="text-success">{locale === "fa" ? "ایجنت شاپینو در حال پاسخ" : "Shopino agent is replying"}</p>
          </div>
          <span className="ms-auto text-[10px] muted">02:14</span>
        </div>
        <div className="flex h-[22rem] flex-col justify-end gap-2 overflow-hidden px-1 pt-3">
          {lines.slice(0, shown).map((l, i) => (
            <div key={i} className={clsx("max-w-[85%] animate-rise", l.from === "c" ? "self-start" : "self-end")}>
              <div className={clsx("rounded-2xl px-3 py-2 text-[13px] leading-6", l.from === "c" ? "bg-[var(--surface-sunken)] strong" : "bg-[var(--accent)] text-[var(--accent-ink)]")}>
                {l.text}
              </div>
              {"link" in l && l.link && (
                <div className="mt-1 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-2 text-[11px]">
                  <Link2 className="size-3.5 text-[var(--accent)]" />
                  <span className="strong">{l.link}</span>
                </div>
              )}
            </div>
          ))}
          {shown < lines.length && lines[shown]?.from === "a" && (
            <div className="self-end rounded-2xl bg-[var(--surface-sunken)] px-3 py-2 text-xs muted">
              <span className="inline-flex gap-1">
                <i className="size-1.5 animate-bounce rounded-full bg-current" />
                <i className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:.15s]" />
                <i className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:.3s]" />
              </span>
            </div>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-full border border-[var(--border)] px-3 py-2 text-xs muted">
          <Check className="size-3.5 text-success" /> {locale === "fa" ? "API رسمی متا" : "Official Meta API"}
        </div>
      </div>
    </div>
  );
}
