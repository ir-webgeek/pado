"use client";

import { Languages, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/locale-client";

type ThemePref = "system" | "day" | "night";
const NEXT: Record<ThemePref, ThemePref> = { system: "day", day: "night", night: "system" };
const ICON = { system: Monitor, day: Sun, night: Moon };

declare global {
  interface Window {
    __applyTheme?: () => void;
  }
}

/** Cycles system -> light -> dark. "system" follows the OS (applied by the inline script in the root layout). */
export function ThemeToggle() {
  const { t } = useI18n();
  const [pref, setPref] = useState<ThemePref>("system");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "day" || saved === "night") setPref(saved);
    } catch {}
  }, []);
  const cycle = () => {
    const next = NEXT[pref];
    setPref(next);
    try {
      if (next === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", next);
    } catch {}
    window.__applyTheme?.();
  };
  const Icon = ICON[pref];
  const label = t(`theme.${pref}`);
  return (
    <button onClick={cycle} className="rounded-full p-2 hover:bg-[var(--surface-sunken)]" aria-label={label} title={label}>
      <Icon className="size-4" />
    </button>
  );
}

export function LangToggle() {
  const { locale, setLocale } = useI18n();
  return (
    <button onClick={() => setLocale(locale === "fa" ? "en" : "fa")} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs hover:bg-[var(--surface-sunken)]">
      <Languages className="size-4" />
      {locale === "fa" ? "EN" : "فا"}
    </button>
  );
}
