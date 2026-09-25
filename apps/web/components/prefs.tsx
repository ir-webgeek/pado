"use client";

import { Languages, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/locale-client";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"night" | "day">("night");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "day" || saved === "night") setTheme(saved);
    } catch {}
  }, []);
  const toggle = () => {
    const next = theme === "night" ? "day" : "night";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {}
  };
  return (
    <button onClick={toggle} className="rounded-full p-2 hover:bg-[var(--surface-sunken)]" aria-label="theme">
      {theme === "night" ? <Sun className="size-4" /> : <Moon className="size-4" />}
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
