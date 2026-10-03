"use client";

import clsx from "clsx";
import { CalendarCheck2, Check, Copy, Layers, Smartphone, Store } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { Button, ErrorNote, Field, Input } from "@/components/ui";
import { UploadButton } from "@/components/upload";
import { api } from "@/lib/api";
import { latinDigits } from "@/lib/format";
import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";

type Kind = "retail" | "services" | "hybrid";
const STEPS = ["business", "brand", "contact", "done"] as const;
const BRAND_COLORS = ["#0b7a6d", "#5b4fa8", "#1a1631", "#c2410c", "#be185d", "#0369a1", "#15803d", "#a16207"];

/** First-run wizard: create the shop, then brand, contact/payment and the links to share. */
export default function OnboardingPage() {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [shop, setShop] = useState<{ id: string; slug: string; kind: Kind } | null>(null);
  return (
    <div className="night-sky flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="glass w-full max-w-lg rounded-[1.75rem] p-7">
        <Logo label={t("brand.name")} />
        <ol className="mt-5 flex gap-1.5" aria-label="progress">
          {STEPS.map((s, i) => (
            <li key={s} className="flex-1">
              <span className={clsx("block h-1.5 rounded-full transition-colors duration-500", i <= step ? "bg-[var(--accent)]" : "bg-[var(--border-strong)]")} />
              <span className={clsx("mt-1.5 block text-[11px]", i === step ? "font-semibold strong" : "muted")}>{t(`onb.step.${s}` as DictKey)}</span>
            </li>
          ))}
        </ol>
        <div key={step} className="mt-6 animate-rise">
          {step === 0 && (
            <BusinessStep
              onCreated={(s) => {
                setShop(s);
                try {
                  localStorage.setItem("shopId", s.id);
                } catch {}
                setStep(1);
              }}
            />
          )}
          {step === 1 && shop && <BrandStep shopId={shop.id} onNext={() => setStep(2)} />}
          {step === 2 && shop && <ContactStep shopId={shop.id} kind={shop.kind} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
          {step === 3 && shop && <DoneStep slug={shop.slug} kind={shop.kind} />}
        </div>
      </div>
    </div>
  );
}

function BusinessStep({ onCreated }: { onCreated: (s: { id: string; slug: string; kind: Kind }) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [kind, setKind] = useState<Kind>("retail");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setAvailable(null);
    if (slug.length < 3) return;
    const id = setTimeout(async () => {
      try {
        const r = await api<{ available: boolean }>(`/shops/slug-available?slug=${encodeURIComponent(slug)}`);
        setAvailable(r.available);
      } catch {}
    }, 350);
    return () => clearTimeout(id);
  }, [slug]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ shop: { id: string; slug: string; kind: Kind } }>("/shops", { method: "POST", json: { name, slug, kind } });
      onCreated(r.shop);
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  const kinds: { v: Kind; icon: typeof Store }[] = [
    { v: "retail", icon: Store },
    { v: "services", icon: CalendarCheck2 },
    { v: "hybrid", icon: Layers },
  ];
  return (
    <form onSubmit={submit} className="space-y-5">
      <h1 className="text-xl font-bold strong">{t("onb.title")}</h1>
      <Field label={t("onb.name")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoFocus />
      </Field>
      <Field label={t("onb.slug")} hint={available === false ? t("onb.slugTaken") : available ? t("onb.slugOk") : `${slug || "my-shop"}.shopino.ir`}>
        <Input dir="ltr" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} required minLength={3} aria-invalid={available === false} />
      </Field>
      <div>
        <span className="label">{t("onb.kind")}</span>
        <div className="grid grid-cols-3 gap-2">
          {kinds.map(({ v, icon: Icon }) => (
            <button
              type="button"
              key={v}
              onClick={() => setKind(v)}
              aria-pressed={kind === v}
              className={clsx("rounded-2xl border p-3 text-start transition", kind === v ? "border-gold/60 bg-gold/10" : "border-[var(--border)] hover:bg-[var(--surface-sunken)]")}
            >
              <Icon className="size-5 text-[var(--accent)]" />
              <p className="mt-2 text-sm font-semibold strong">{t(`onb.kind.${v}`)}</p>
              <p className="text-[11px] muted">{t(`onb.kind.${v}.s`)}</p>
            </button>
          ))}
        </div>
      </div>
      <ErrorNote error={error} />
      <Button variant="primary" size="lg" className="w-full" loading={loading} disabled={available === false}>
        {t("onb.create")}
      </Button>
    </form>
  );
}

function BrandStep({ shopId, onNext }: { shopId: string; onNext: () => void }) {
  const { t } = useI18n();
  const [color, setColor] = useState(BRAND_COLORS[0]!);
  const [logo, setLogo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/shops/${shopId}/settings`, { method: "PATCH", json: { brandColor: color, ...(logo ? { logo } : {}) } });
      onNext();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold strong">{t("onb.brand.t")}</h2>
        <p className="mt-1 text-sm muted">{t("onb.brand.s")}</p>
      </div>
      <div className="flex flex-wrap gap-2.5">
        {BRAND_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            aria-pressed={color === c}
            onClick={() => setColor(c)}
            className={clsx("size-9 rounded-full transition", color === c && "ring-2 ring-[var(--ring)] ring-offset-2 ring-offset-[var(--bg-elev)]")}
            style={{ background: c }}
          />
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="label !mb-0">{t("onb.logo")}</span>
        {logo && <img src={logo} alt="" className="size-12 rounded-xl object-cover" />}
        <UploadButton shopId={shopId} label={t("sv.upload")} onUploaded={setLogo} />
      </div>
      {/* live preview of the accent on a light customer page */}
      <div data-theme="day" className="rounded-2xl border border-[var(--border)] bg-[var(--bg)] p-4" style={{ "--accent": color } as React.CSSProperties}>
        <span className="inline-flex h-9 items-center rounded-full bg-[var(--accent)] px-4 text-sm font-medium text-white">{t("bk.confirm")}</span>
      </div>
      <ErrorNote error={error} />
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onNext}>{t("onb.skip")}</Button>
        <Button variant="primary" className="flex-1" loading={busy} onClick={save}>{t("onb.next")}</Button>
      </div>
    </div>
  );
}

function ContactStep({ shopId, kind, onBack, onNext }: { shopId: string; kind: Kind; onBack: () => void; onNext: () => void }) {
  const { t } = useI18n();
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [card, setCard] = useState({ cardNumber: "", holder: "", bank: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/shops/${shopId}/settings`, {
        method: "PATCH",
        json: {
          invoice: { phone: latinDigits(phone), address },
          ...(card.cardNumber ? { cardToCard: { ...card, cardNumber: latinDigits(card.cardNumber).replace(/\D/g, "") } } : {}),
        },
      });
      onNext();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold strong">{t("onb.contact.t")}</h2>
        <p className="mt-1 text-sm muted">{t("onb.contact.s")}</p>
      </div>
      <Field label={t("auth.phone")}>
        <Input dir="ltr" inputMode="tel" value={phone} maxLength={40} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      {kind !== "services" && (
        <Field label={t("s.invoiceAddress")}>
          <Input value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} />
        </Field>
      )}
      <Field label={t("s.card")}>
        <Input dir="ltr" inputMode="numeric" placeholder="6037 ...." value={card.cardNumber} maxLength={19} onChange={(e) => setCard({ ...card, cardNumber: e.target.value })} />
      </Field>
      {card.cardNumber && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("s.cardHolder")}>
            <Input value={card.holder} maxLength={80} onChange={(e) => setCard({ ...card, holder: e.target.value })} />
          </Field>
          <Field label={t("s.bank")}>
            <Input value={card.bank} maxLength={40} onChange={(e) => setCard({ ...card, bank: e.target.value })} />
          </Field>
        </div>
      )}
      <ErrorNote error={error} />
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onBack}>{t("onb.back")}</Button>
        <Button variant="ghost" onClick={onNext}>{t("onb.skip")}</Button>
        <Button variant="primary" className="flex-1" loading={busy} onClick={save}>{t("onb.next")}</Button>
      </div>
    </div>
  );
}

function DoneStep({ slug, kind }: { slug: string; kind: Kind }) {
  const { t } = useI18n();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const links = [
    ...(kind !== "services" ? [{ label: t("onb.storeLink"), url: `${origin}/s/${slug}` }] : []),
    ...(kind !== "retail" ? [{ label: t("onb.bookingLink"), url: `${origin}/b/${slug}` }] : []),
  ];
  return (
    <div className="space-y-5">
      <div className="text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-gold/15 text-[var(--accent)]">
          <Check className="size-6" />
        </span>
        <h2 className="mt-3 text-lg font-bold strong">{t("onb.done.t")}</h2>
        <p className="mt-1 text-sm muted">{t("onb.done.s")}</p>
      </div>
      {links.map((l) => (
        <CopyRow key={l.url} label={l.label} url={l.url} />
      ))}
      <Link href="/panel" className="flex h-12 w-full items-center justify-center rounded-full bg-[var(--accent)] font-medium text-[var(--accent-ink)]">
        {t("onb.goPanel")}
      </Link>
      <Link href="/install" className="flex items-center justify-center gap-1.5 text-sm muted hover:text-[var(--text)]">
        <Smartphone className="size-4" /> {t("onb.installApp")}
      </Link>
    </div>
  );
}

function CopyRow({ label, url }: { label: string; url: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-1.5 ps-3">
        <span className="min-w-0 flex-1 truncate text-sm strong" dir="ltr">{url}</span>
        <Button size="sm" onClick={() => (navigator.clipboard.writeText(url), setCopied(true))}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? t("a.copied") : t("a.copy")}
        </Button>
      </div>
    </div>
  );
}
