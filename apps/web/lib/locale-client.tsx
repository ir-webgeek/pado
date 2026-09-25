"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { translator, type DictKey, type Locale } from "./i18n";

interface Ctx {
  locale: Locale;
  t: (k: DictKey) => string;
  setLocale: (l: Locale) => void;
}

const LocaleContext = createContext<Ctx | null>(null);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const setLocale = useCallback((l: Locale) => {
    document.cookie = `lang=${l}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  }, []);
  const value = useMemo(() => ({ locale, t: translator(locale), setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useI18n outside LocaleProvider");
  return ctx;
}
