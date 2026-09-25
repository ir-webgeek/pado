"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { Sky } from "@/components/landing/sky";
import { Button, ErrorNote, Field, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { latinDigits } from "@/lib/format";
import { useI18n } from "@/lib/locale-client";

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ devCode?: string }>("/auth/otp", { method: "POST", json: { phone: latinDigits(phone) } });
      setDevCode(r.devCode ?? null);
      setStep("code");
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api("/auth/verify", { method: "POST", json: { phone: latinDigits(phone), code: latinDigits(code) } });
      const me = await api<{ shops: unknown[] }>("/auth/me");
      router.replace(me.shops.length ? "/panel" : "/onboarding");
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  return (
    <div className="night-sky relative flex min-h-dvh items-center justify-center px-4">
      <Sky />
      <div className="glass relative w-full max-w-sm rounded-[1.75rem] p-7">
        <Link href="/" className="mb-6 inline-block">
          <Logo label={t("brand.name")} />
        </Link>
        <h1 className="mb-6 text-xl font-bold strong">{t("auth.title")}</h1>
        {step === "phone" ? (
          <form onSubmit={sendCode} className="space-y-4">
            <Field label={t("auth.phone")}>
              <Input dir="ltr" inputMode="tel" autoFocus placeholder="0912 000 0000" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            </Field>
            <ErrorNote error={error} />
            <Button variant="primary" size="lg" className="w-full" loading={loading}>
              {t("auth.sendCode")}
            </Button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-4">
            <Field label={t("auth.code")} hint={devCode ? `${t("auth.devCode")}: ${devCode}` : undefined}>
              <Input dir="ltr" inputMode="numeric" autoFocus maxLength={5} className="text-center text-lg tracking-[.5em]" value={code} onChange={(e) => setCode(e.target.value)} required />
            </Field>
            <ErrorNote error={error} />
            <Button variant="primary" size="lg" className="w-full" loading={loading}>
              {t("auth.verify")}
            </Button>
            <button type="button" className="w-full text-sm muted" onClick={() => setStep("phone")}>
              {t("auth.changePhone")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
