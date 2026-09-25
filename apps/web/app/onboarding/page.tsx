"use client";

import clsx from "clsx";
import { CalendarCheck2, Layers, Store } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { Button, ErrorNote, Field, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/locale-client";

type Kind = "retail" | "services" | "hybrid";

export default function OnboardingPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [kind, setKind] = useState<Kind>("retail");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ shop: { id: string } }>("/shops", { method: "POST", json: { name, slug, kind } });
      localStorage.setItem("shopId", r.shop.id);
      router.replace("/panel");
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
    <div className="night-sky flex min-h-dvh items-center justify-center px-4 py-10">
      <form onSubmit={submit} className="glass w-full max-w-lg space-y-5 rounded-[1.75rem] p-7">
        <Logo label={t("brand.name")} />
        <h1 className="text-xl font-bold strong">{t("onb.title")}</h1>
        <Field label={t("onb.name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        </Field>
        <Field label={t("onb.slug")} hint={`${slug || "my-shop"}.shopino.ir`}>
          <Input dir="ltr" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} required minLength={3} />
        </Field>
        <div>
          <span className="label">{t("onb.kind")}</span>
          <div className="grid grid-cols-3 gap-2">
            {kinds.map(({ v, icon: Icon }) => (
              <button
                type="button"
                key={v}
                onClick={() => setKind(v)}
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
        <Button variant="primary" size="lg" className="w-full" loading={loading}>
          {t("onb.create")}
        </Button>
      </form>
    </div>
  );
}
