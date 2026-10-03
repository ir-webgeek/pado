"use client";

import clsx from "clsx";
import { CheckCircle2, Download, Maximize2, Monitor, RefreshCw, Smartphone, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { LangToggle, ThemeToggle } from "@/components/prefs";
import { isStandalone, useInstallPrompt } from "@/components/pwa";
import { Button, Tabs } from "@/components/ui";
import type { DictKey } from "@/lib/i18n";
import { useI18n } from "@/lib/locale-client";

type Platform = "android" | "ios" | "desktop";
const STEPS: Record<Platform, number> = { android: 4, ios: 4, desktop: 3 };

function detect(): Platform {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch support tells them apart
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

export default function InstallPage() {
  const { t } = useI18n();
  const [platform, setPlatform] = useState<Platform>("android");
  const [installed, setInstalled] = useState(false);
  const { available, install } = useInstallPrompt();
  useEffect(() => {
    setPlatform(detect());
    setInstalled(isStandalone());
  }, []);
  const why = [
    { icon: Maximize2, k: "pwa.why1" },
    { icon: Zap, k: "pwa.why2" },
    { icon: RefreshCw, k: "pwa.why3" },
  ] as const;
  return (
    <div className="night-sky min-h-dvh">
      <header className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
        <Link href="/">
          <Logo label={t("brand.name")} />
        </Link>
        <div className="flex items-center">
          <LangToggle />
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16">
        <section className="animate-rise py-8 text-center">
          <img src="/icons/icon-192.png" alt="" className="mx-auto size-20 rounded-[1.4rem] shadow-xl" />
          <h1 className="mt-5 text-2xl font-bold strong sm:text-3xl">{t("pwa.title")}</h1>
          <p className="mx-auto mt-3 max-w-xl leading-8 muted">{t("pwa.sub")}</p>
          {installed ? (
            <p className="mx-auto mt-6 inline-flex items-center gap-2 rounded-full bg-success/12 px-4 py-2 text-sm text-success">
              <CheckCircle2 className="size-4" /> {t("pwa.installed")}
            </p>
          ) : (
            available && (
              <Button variant="primary" size="lg" className="mt-6" onClick={() => install().then((ok) => ok && setInstalled(true))}>
                <Download className="size-5" /> {t("pwa.installNow")}
              </Button>
            )
          )}
        </section>

        <ul className="mb-8 grid gap-3 sm:grid-cols-3">
          {why.map((w) => (
            <li key={w.k} className="card flex items-center gap-3 p-4 text-sm">
              <w.icon className="size-5 shrink-0 text-[var(--accent)]" />
              <span className="strong">{t(w.k)}</span>
            </li>
          ))}
        </ul>

        <div className="mb-4 flex justify-center">
          <Tabs
            value={platform}
            onChange={setPlatform}
            items={[
              { value: "android", label: t("pwa.android") },
              { value: "ios", label: t("pwa.ios") },
              { value: "desktop", label: t("pwa.desktop") },
            ]}
          />
        </div>
        <ol key={platform} className="card animate-rise space-y-1 p-3 sm:p-4">
          {Array.from({ length: STEPS[platform] }, (_, i) => (
            <li key={i} className="flex items-start gap-3 rounded-xl p-3">
              <span className={clsx("num flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold", "bg-gold/15 text-[var(--accent)]")}>{i + 1}</span>
              <span className="pt-0.5 leading-7 strong">{t(`pwa.${platform}.${i + 1}` as DictKey)}</span>
            </li>
          ))}
        </ol>
        <p className="mt-6 flex items-center justify-center gap-2 text-xs muted">
          {platform === "desktop" ? <Monitor className="size-4" /> : <Smartphone className="size-4" />}
          {t(`pwa.${platform}` as DictKey)}
        </p>
      </main>
    </div>
  );
}
