import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BellRing,
  Bot,
  CalendarCheck2,
  Check,
  Crown,
  CreditCard,
  Globe,
  Infinity as InfinityIcon,
  Layers,
  PackageCheck,
  Sparkles,
  Store,
  X,
} from "lucide-react";
import { AgentFlow } from "@/components/landing/agent-flow";
import { SiteFooter } from "@/components/landing/footer";
import { SiteNav } from "@/components/landing/nav";
import { PanelPreview } from "@/components/landing/panel-preview";
import { PricingCards } from "@/components/landing/pricing-cards";
import { Sky } from "@/components/landing/sky";
import { Reveal } from "@/components/reveal";
import { getT } from "@/lib/locale-server";
import type { DictKey } from "@/lib/i18n";

// calendar mock: accent, lavender and a warm peach, all dark-ink legible
const MOCK_COLORS = ["#3ddbc4", "#b3a8f0", "#f4b88a"];

function Section({ id, kicker, title, sub, children }: { id?: string; kicker?: string; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:py-24">
      <Reveal className="mx-auto mb-10 max-w-2xl text-center">
        {kicker && <p className="mb-3 text-sm font-medium text-[var(--accent)]">{kicker}</p>}
        <h2 className="text-2xl font-bold leading-tight strong sm:text-4xl">{title}</h2>
        {sub && <p className="mt-4 muted sm:text-lg">{sub}</p>}
      </Reveal>
      {children}
    </section>
  );
}

export default async function Home() {
  const { t, locale } = await getT();
  const Arrow = locale === "fa" ? ArrowLeft : ArrowRight;

  const features: { icon: typeof Bot; k: string; span?: string }[] = [
    { icon: Bot, k: "agent", span: "md:col-span-2 md:row-span-2" },
    { icon: CalendarCheck2, k: "booking" },
    { icon: PackageCheck, k: "orders" },
    { icon: Crown, k: "club" },
    { icon: CreditCard, k: "pay" },
    { icon: Globe, k: "site" },
    { icon: BellRing, k: "reminder" },
    { icon: BarChart3, k: "reports", span: "md:col-span-2" },
  ];

  const chips = [
    { icon: InfinityIcon, t: "hero.chip1", s: "hero.chip1s" },
    { icon: CalendarCheck2, t: "hero.chip2", s: "hero.chip2s" },
    { icon: Crown, t: "hero.chip3", s: "hero.chip3s" },
    { icon: Layers, t: "hero.chip4", s: "hero.chip4s" },
  ] as const;

  const compare = [
    {
      title: t("cmp.a"),
      tone: "danger",
      points: locale === "fa" ? ["۹ ساعت بدون جواب", "شماره کارت و آدرس توی دایرکت", "کد رهگیری «بعداً»"] : ["9 hours without a reply", "Card number & address in the DM", "Tracking code \"later\""],
    },
    {
      title: t("cmp.b"),
      tone: "info",
      points: locale === "fa" ? ["لینک تکمیل سفارش به‌جای شماره کارت", "آدرس و پرداخت خودکار", "همون لینک صفحه رهگیری می‌شه"] : ["An order link instead of a card number", "Address & payment handled", "Same link becomes the tracking page"],
    },
    {
      title: t("cmp.c"),
      tone: "gold",
      points: locale === "fa" ? ["جواب فوری ساعت ۲ بامداد", "پرداخت و نوبت داخل همون دایرکت", "کد رهگیری و یادآوری خودکار"] : ["Instant reply at 2 AM", "Payment & booking inside the DM", "Tracking code & reminders post themselves"],
    },
  ];

  return (
    <div className="night-sky min-h-dvh">
      <SiteNav />

      {/* hero */}
      <section className="relative overflow-hidden">
        <Sky />
        <div className="relative mx-auto max-w-6xl px-4 pb-10 pt-14 text-center sm:pt-20">
          <p className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-1 text-xs muted animate-rise">
            <Sparkles className="size-3.5 text-[var(--accent)]" /> {t("hero.kicker")}
          </p>
          <h1 className="text-4xl font-extrabold leading-[1.25] strong animate-rise sm:text-6xl">
            {t("hero.title1")}
            <br />
            <span className="hero-gradient">{t("hero.title2")}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-8 muted animate-rise sm:text-lg [animation-delay:.1s]">{t("hero.sub")}</p>

          <div className="mx-auto mt-8 grid max-w-3xl grid-cols-2 gap-3 animate-rise sm:grid-cols-4 [animation-delay:.2s]">
            {chips.map((c) => (
              <div key={c.t} className="flex items-center gap-2.5 rounded-2xl border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2.5 text-start">
                <c.icon className="size-5 shrink-0 text-[var(--accent)]" />
                <div>
                  <p className="text-sm font-semibold strong">{t(c.t)}</p>
                  <p className="text-[11px] muted">{t(c.s)}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3 animate-rise [animation-delay:.3s]">
            <Link href="/login" className="relative inline-flex h-12 items-center gap-2 rounded-full bg-[var(--accent)] px-7 font-medium text-[var(--accent-ink)] shadow-[0_12px_40px_-12px_var(--accent)] transition hover:brightness-105">
              <span aria-hidden className="absolute -inset-1 -z-10 rounded-full bg-gold/30 blur-md animate-halo" />
              {t("cta.start")}
            </Link>
            <Link href="/b/atelier-raha" className="inline-flex h-12 items-center gap-2 rounded-full px-5 text-sm strong hover:bg-[var(--surface-sunken)]">
              {t("cta.demo")} <Arrow className="size-4" />
            </Link>
          </div>
          <p className="mt-4 text-xs muted">{t("hero.trust")}</p>
        </div>
        <div className="relative px-3 pb-16">
          <PanelPreview t={t} locale={locale} />
        </div>
      </section>

      {/* features bento */}
      <Section id="features" kicker={t("sec.what.k")} title={t("sec.what.t")} sub={t("sec.what.s")}>
        <div className="grid gap-3 md:grid-cols-4">
          {features.map((f, i) => (
            <Reveal key={f.k} delay={i * 60} className={`card group relative overflow-hidden p-6 transition hover:-translate-y-0.5 hover:border-gold/30 ${f.span ?? ""}`}>
              <div className="absolute -end-10 -top-10 size-32 rounded-full bg-gold/5 blur-2xl transition group-hover:bg-gold/15" />
              <f.icon className="size-6 text-[var(--accent)]" />
              <h3 className="mt-4 font-semibold strong">{t(`f.${f.k}.t` as DictKey)}</h3>
              <p className="mt-1.5 text-sm leading-7 muted">{t(`f.${f.k}.s` as DictKey)}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* agent flow */}
      <Section kicker={t("sec.flow.k")} title={t("sec.flow.t")}>
        <AgentFlow />
      </Section>

      {/* appointments */}
      <Section id="appointments" kicker={t("sec.appt.k")} title={t("sec.appt.t")} sub={t("sec.appt.s")}>
        <div className="grid items-center gap-8 lg:grid-cols-2">
          <ul className="grid gap-3 sm:grid-cols-2">
            {(["appt.b1", "appt.b2", "appt.b3", "appt.b4", "appt.b5", "appt.b6"] as const).map((k, i) => (
              <li key={k}>
                <Reveal delay={i * 60} className="card flex h-full gap-3 p-4 text-sm">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" />
                  <span className="strong">{t(k)}</span>
                </Reveal>
              </li>
            ))}
          </ul>
          <Reveal delay={120} className="glass rounded-[1.75rem] p-4">
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="font-semibold strong">{locale === "fa" ? "شنبه ۴ مهر" : "Sat, Sep 26"}</span>
              <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">{locale === "fa" ? "۸۲٪ اشغال" : "82% booked"}</span>
            </div>
            <div className="grid grid-cols-[3rem_1fr_1fr_1fr] gap-2 text-[11px]">
              <div />
              {(locale === "fa" ? ["رها", "نازنین", "مینا"] : ["Raha", "Nazanin", "Mina"]).map((n, i) => (
                <div key={n} className="flex items-center gap-1.5 font-medium strong">
                  <span className="size-2 rounded-full" style={{ background: MOCK_COLORS[i] }} /> {n}
                </div>
              ))}
              {["10:00", "11:00", "12:00", "13:00", "14:00"].map((h, row) => (
                <div key={h} className="contents">
                  <div className="num pt-1 muted">{h}</div>
                  {[0, 1, 2].map((c) => {
                    const busy = (row + c) % 3 !== 1;
                    return (
                      <div key={c} className={`h-11 rounded-lg ${busy ? "" : "border border-dashed border-[var(--border-strong)]"}`} style={busy ? { background: MOCK_COLORS[c], opacity: 0.85 } : {}}>
                        {busy && <span className="block px-1.5 py-1 font-medium text-ink-900">{locale === "fa" ? ["کوتاهی", "رنگ مو", "مانیکور"][c] : ["Haircut", "Color", "Manicure"][c]}</span>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </Section>

      {/* compare */}
      <Section kicker={t("sec.compare.k")} title={t("sec.compare.t")}>
        <div className="grid gap-4 md:grid-cols-3">
          {compare.map((c, i) => (
            <Reveal key={c.title} delay={i * 90} className={`card p-6 ${i === 2 ? "border-gold/40 bg-gradient-to-b from-gold/10 to-transparent" : ""}`}>
              <div className="mb-4 flex items-center gap-2">
                {i === 0 ? <X className="size-5 text-danger" /> : i === 1 ? <Store className="size-5 text-info" /> : <Bot className="size-5 text-[var(--accent)]" />}
                <h3 className="font-semibold strong">{c.title}</h3>
              </div>
              <ul className="space-y-2.5 text-sm">
                {c.points.map((p) => (
                  <li key={p} className="flex gap-2">
                    {i === 0 ? <X className="mt-0.5 size-4 shrink-0 text-danger/80" /> : <Check className="mt-0.5 size-4 shrink-0 text-success" />}
                    <span className={i === 0 ? "muted" : "strong"}>{p}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* pricing */}
      <Section id="pricing" title={t("sec.pricing.t")} sub={t("sec.pricing.s")}>
        <PricingCards />
      </Section>

      {/* faq */}
      <Section id="faq" title={t("sec.faq.t")}>
        <div className="mx-auto max-w-3xl space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <details key={i} className="card group p-0 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4 font-medium strong">
                {t(`faq.q${i}` as DictKey)}
                <span className="text-xl muted transition group-open:rotate-45">+</span>
              </summary>
              <p className="px-5 pb-5 text-sm leading-7 muted">{t(`faq.a${i}` as DictKey)}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* final CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-20">
        <Reveal className="glass relative overflow-hidden rounded-[2rem] px-6 py-14 text-center">
          <div className="absolute inset-0 bg-[radial-gradient(600px_200px_at_50%_0%,rgb(61_219_196/.18),transparent)]" />
          <h2 className="relative text-2xl font-bold strong sm:text-4xl">{t("cta.final.t")}</h2>
          <p className="relative mt-3 muted">{t("cta.final.s")}</p>
          <Link href="/login" className="relative mt-8 inline-flex h-12 items-center rounded-full bg-[var(--accent)] px-8 font-medium text-[var(--accent-ink)]">
            {t("cta.start")}
          </Link>
        </Reveal>
      </section>

      <SiteFooter t={t} />
    </div>
  );
}
