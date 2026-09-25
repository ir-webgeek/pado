"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { LangToggle, ThemeToggle } from "@/components/prefs";
import { useI18n } from "@/lib/locale-client";

export function SiteNav() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const links = [
    { href: "/#features", label: t("nav.features") },
    { href: "/#appointments", label: t("nav.appointments") },
    { href: "/pricing", label: t("nav.pricing") },
    { href: "/#faq", label: t("nav.faq") },
  ];
  return (
    <header className={`sticky top-0 z-40 transition ${scrolled ? "glass !rounded-none !border-x-0 !border-t-0" : ""}`}>
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" aria-label="home">
          <Logo label={t("brand.name")} />
        </Link>
        <div className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-full px-3.5 py-2 text-sm muted transition hover:text-[var(--text)]">
              {l.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <LangToggle />
          <ThemeToggle />
          <Link href="/login" className="ms-1 hidden h-9 items-center rounded-full border border-[var(--border-strong)] px-4 text-sm strong transition hover:bg-[var(--surface-sunken)] sm:inline-flex">
            {t("nav.login")}
          </Link>
          <button className="rounded-full p-2 md:hidden" onClick={() => setOpen((v) => !v)} aria-label="menu">
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </nav>
      {open && (
        <div className="glass mx-3 mb-3 flex flex-col gap-1 rounded-2xl p-2 md:hidden">
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="rounded-xl px-3 py-2.5 text-sm strong hover:bg-[var(--surface-sunken)]">
              {l.label}
            </Link>
          ))}
          <Link href="/login" className="rounded-xl bg-[var(--accent)] px-3 py-2.5 text-center text-sm font-medium text-[var(--accent-ink)]">
            {t("nav.login")}
          </Link>
        </div>
      )}
    </header>
  );
}
